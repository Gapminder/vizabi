import * as utils from 'base/utils';
import Promise from 'base/promise';
import Reader from 'base/reader';

var DDF1CSVReader = Reader.extend({

  /**
   * Initializes the reader.
   * @param {Object} reader_info Information about the reader
   */
  init: function (reader_info) {
    this._name = 'ddf1-csv';
    this._data = [];
    this._ddfPath = reader_info.path;
    this.ddf = new Ddf(this._ddfPath);
  },

  /**
   * Reads from source
   * @param {Object} query to be performed
   * @param {String} language language
   * @returns a promise that will be resolved when data is read
   */
  read: function (queryPar, language) {
    var _this = this;
    var query = utils.deepExtend({}, queryPar);
    var p = new Promise();

    _this.ddf.getIndex(function () {
      // get `concepts` and `entries` in any case
      // this data needed for query's kind (service, data point) detection
      _this.ddf.getConceptsAndEntities(query, function () {
        // service query: it was detected by next criteria:
        // all of `select` section of query parts are NOT measures
        if (_this.ddf.divideByQuery(query).measures.length <= 0) {
          _this._data = entities;
          p.resolve();
        }

        // data point query: it was detected by next criteria:
        // at least one measure was detected in `select` section of the query
        if (_this.ddf.divideByQuery(query).measures.length > 0) {
          _this.ddf.getDataPoints(query, function (data) {
            _this._data = data;
            p.resolve();
          });
        }
      });
    });

    return p;
  },

  /**
   * Gets the data
   * @returns all data
   */
  getData: function () {
    return this._data;
  }
});

/// DDF specific

var index = null;
var concepts = null;
var conceptTypeHash = {};
var entities = null;

function Ddf(ddfPath) {
  this.ddfPath = ddfPath;

  var parser = document.createElement('a');
  parser.href = ddfPath;

  this.ddfPathPrefix = parser.protocol + '//' + parser.host;
  this.filesList = this.getFilesList();
}

Ddf.prototype.getFilesList = function () {
  var result = [];
  var xmlHttp = new XMLHttpRequest();
  xmlHttp.open('GET', this.ddfPath, false);
  xmlHttp.send(null);

  var hrefPattern = /<a href="(.*?)"/g;
  var match = null;
  while (match = hrefPattern.exec(xmlHttp.responseText)) {
    if (match[1].endsWith('.csv')) {
      result.push(this.ddfPathPrefix + match[1]);
    }
  }

  return result;
};

Ddf.prototype.getIndex = function (cb) {
  if (index) {
    return cb();
  }

  var indexAction = null;
  var indexFileName = null;

  for (var i = 0; i < this.filesList.length; i++) {
    if (this.filesList[i].endsWith('ddf--index.csv')) {
      indexFileName = this.filesList[i];
      indexAction = load(this.filesList[i]);
      break;
    }
  }

  if (indexAction === null) {
    return cb();
  }

  indexAction.then(function () {
    index = CACHE.FILE_CACHED[indexFileName];
    cb();
  });
};

Ddf.prototype.getConceptFileNames = function () {
  var _this = this;
  var result = [];

  // first priority: concepts from index file
  if (index) {
    index.forEach(function (indexRecord) {
      if (indexRecord.key === 'concept') {
        result.push(_this.ddfPath + '/' + indexRecord.file);
      }
    });
  }

  // second priority: concepts from generic list of files
  _this.filesList.forEach(function (file) {
    if (file.indexOf('ddf--concepts') >= 0) {
      result.push(file);
    }
  });

  return utils.unique(result);
};

Ddf.prototype.getEntityFileNames = function () {
  var _this = this;
  var result = [];

  // first priority: entities from index file
  if (index) {
    index.forEach(function (indexRecord) {
      if (conceptTypeHash[indexRecord.key] === 'entity_domain') {
        result.push(_this.ddfPath + '/' + indexRecord.file);
      }
    });
  }

  // second priority: entities from generic list of files
  _this.filesList.forEach(function (file) {
    if (file.indexOf('ddf--entities--') >= 0) {
      result.push(file);
    }
  });

  return utils.unique(result);
};

// this method detects kind of particular entity file
Ddf.prototype.getHeaderDescriptor = function (select, firstRecord) {
  var count = 0;
  var convert = {};

  // following code answers next question:
  // `Is this set of entities contains all of selectable concepts?`
  // or `Is this entities file good for given query?`
  select.map(function (field) {
    // headers should not contain data before `.`
    var pos = field.indexOf('.');
    var _field = pos >= 0 ? field.substr(pos + 1) : field;

    if (firstRecord[_field]) {
      convert[_field] = field;
      count++;
    }
  });

  return {
    // this entity file is expected for future processing
    // if at least one criteria was matched
    needed: count > 0,
    convert: convert
  };
};

Ddf.prototype.applyFilter = function (record, filter) {
  var matches = 0;

  for (var k in filter) {
    if (filter.hasOwnProperty(k)) {
      var pos = k.indexOf('.');
      var normConcept = pos >= 0 ? k.substr(pos + 1) : k;

      if (!record[normConcept]) {
        continue;
      }

      if (record[normConcept].toUpperCase() ===
        filter[k].toString().toUpperCase()) {
        matches++;
      }
    }
  }

  return Object.keys(filter).length === matches;
};

// get information for entity correction by filter
// for example rule `geo.is--country: true` will be generate pair: `geo: "country"`
// it will be needed when geo column in the entity css is 'country', but Vizabi expects only "geo"
Ddf.prototype.getFilterConvertPairs = function (filter) {
  var result = {};

  for (var k in filter) {
    if (filter.hasOwnProperty(k)) {
      var pos = k.indexOf('.');
      if (pos >= 0) {
        result[k.substr(0, pos)] = k.substr(pos).replace(/^.is--/, '');
      }
    }
  }

  return result;
};

Ddf.prototype.normalizeAndFilter = function (headerDescriptor, content, filter) {
  var _this = this;
  var result = [];
  var convertPairs = _this.getFilterConvertPairs(filter);

  content.forEach(function (record) {
    if (!_this.applyFilter(record, filter)) {
      return;
    }

    var _record = {};

    for (var field in record) {
      if (record.hasOwnProperty(field)) {
        // get filtered data with expected prefix
        // for example, correct:
        // transform (in `geo` file) column `name` to `geo.name` field in `Vizabi's data`
        var _field = headerDescriptor.convert[field];

        // add Vizabi oriented data if related concepts are not same in the csv file
        for (var convertPairKey in convertPairs) {
          if (convertPairs.hasOwnProperty(convertPairKey) && record[convertPairs[convertPairKey]]) {
            _record[convertPairKey] = record[convertPairs[convertPairKey]];
          }
        }

        if (_field) {
          _record[_field] = record[field];
        }
      }
    }

    result.push(_record);
  });

  return result;
};

Ddf.prototype.getEntities = function (query, cb) {
  var _this = this;
  var entityActions = [];
  var entityFileNames = _this.getEntityFileNames();

  entityFileNames.forEach(function (fileName) {
    entityActions.push(load(fileName));
  });

  // secondly we should get entities
  Promise.all(entityActions).then(function () {
    var _entities = [];

    Object.keys(CACHE.FILE_CACHED).forEach(function (fileName) {
      if (entityFileNames.indexOf(fileName) >= 0) {
        var headerDescriptor = _this.getHeaderDescriptor(query.select, CACHE.FILE_CACHED[fileName][0]);

        // apply filter only for entities?
        if (headerDescriptor.needed === true) {
          _entities = _entities
            .concat(_this.normalizeAndFilter(headerDescriptor, CACHE.FILE_CACHED[fileName], query.where));
        }
      }
    });

    if (_entities.length > 0) {
      entities = _entities;
    }

    cb();
  });
};

Ddf.prototype.getConcepts = function (query, cb) {
  var _this = this;
  var conceptActions = [];
  var conceptFileNames = _this.getConceptFileNames();

  conceptFileNames.forEach(function (fileName) {
    conceptActions.push(load(fileName));
  });

  // first of all we need concepts
  Promise.all(conceptActions).then(function () {
    var _concepts = [];

    Object.keys(CACHE.FILE_CACHED).forEach(function (fileName) {
      if (conceptFileNames.indexOf(fileName) >= 0) {
        _concepts = _concepts.concat(CACHE.FILE_CACHED[fileName]);
      }
    });

    if (_concepts.length > 0) {
      concepts = _concepts;
      concepts.forEach(function (concept) {
        var splittedConcepts = concept.concept.split(/,/);

        splittedConcepts.forEach(function (splittedConcept) {
          conceptTypeHash[splittedConcept] = concept.concept_type;
        });
      });
    }

    cb();
  });
};

Ddf.prototype.getConceptsAndEntities = function (query, cb) {
  var _this = this;

  _this.getConcepts(query, function () {
    _this.getEntities(query, function () {
      cb();
    });
  });
};

// extract measures and other concept names from query
Ddf.prototype.divideByQuery = function (query) {
  var measures = [];
  var other = [];

  query.select.forEach(function (partOfSelect) {
    if (conceptTypeHash[partOfSelect] === 'measure') {
      measures.push(partOfSelect);
    }

    if (conceptTypeHash[partOfSelect] !== 'measure') {
      other.push(partOfSelect);
    }
  });

  return {
    measures: measures,
    other: other
  };
};

Ddf.prototype.getDataPointDescriptorsByIndex = function (query) {
  var _this = this;
  var descriptors = [];
  var fileNames = [];

  if (index) {
    index.forEach(function (indexRecord) {
      if (conceptTypeHash[indexRecord.value] === 'measure') {
        var other = indexRecord.key.split(/,/);
        var parts = other.concat(indexRecord.value);
        var founded = 0;

        parts.forEach(function (part) {
          if (query.select.indexOf(part) >= 0) {
            founded++;
          }
        });

        if (founded === parts.length) {
          fileNames.push(_this.ddfPath + '/' + indexRecord.file);
          descriptors.push({
            fileName: _this.ddfPath + '/' + indexRecord.file,
            measures: [indexRecord.value],
            // only one measure should be present in DDF1 data point in case of Vizabi using?
            measure: indexRecord.value,
            other: other
          });
        }
      }
    });
  }

  return {
    descriptors: descriptors,
    fileNames: fileNames
  };
};

Ddf.prototype.getDataPointDescriptorsByFilesList = function (query) {
  var _this = this;
  var descriptors = [];
  var fileNames = [];

  // how many matches in of given criteria
  // (measure or other concept) was found in the file name
  function matchByArray(criteria, fileName) {
    var found = [];

    criteria.forEach(function (_criteria) {
      if (fileName.indexOf('--' + _criteria) > 0 &&
        (fileName.indexOf(_criteria + '--') > 0 || fileName.indexOf(_criteria + '.') > 0)) {
        found.push(_criteria);
      }
    });

    return found;
  }

  this.filesList.forEach(function (fileName) {
    var foundMeasures = matchByArray(_this.categorizedQuery.measures, fileName);
    var foundOther = matchByArray(_this.categorizedQuery.other, fileName);

    // rule for data point: one measure - many other (time, entity_domain) ?
    if (foundMeasures.length === 1 && foundOther.length === _this.categorizedQuery.other.length) {
      fileNames.push(fileName);
      descriptors.push({
        fileName: fileName,
        measures: _this.categorizedQuery.measures,
        // only one measure should be present in DDF1 data point in case of Vizabi using?
        measure: foundMeasures[0],
        other: _this.categorizedQuery.other
      });
    }
  });

  return descriptors;
};

// data points descriptors will be used for data points content loading
Ddf.prototype.getDataPointDescriptors = function (query) {
  this.categorizedQuery = this.divideByQuery(query);

  // first priority - index
  var descResultByIndex = this.getDataPointDescriptorsByIndex(query);
  var result = descResultByIndex.descriptors;
  // second priority - list of files
  var descResultByFileList = this.getDataPointDescriptorsByFilesList(query);

  // add missing data points descriptors in accordance with list of files
  descResultByFileList.forEach(function (descRecord) {
    if (descResultByIndex.fileNames.indexOf(descRecord.fileName) < 0) {
      result.push(descRecord);
    }
  });

  return result;
};

// get data points source
Ddf.prototype.getDataPointsContent = function (query, cb) {
  var _this = this;
  var actions = [];

  this.dataPointDescriptors = this.getDataPointDescriptors(query);

  this.dataPointDescriptors.forEach(function (dataPointDescriptor) {
    actions.push(load(dataPointDescriptor.fileName));
  });

  Promise.all(actions).then(function () {
    _this.dataPointDescriptors.forEach(function (dataPointDescriptor) {
      dataPointDescriptor.content = CACHE.FILE_CACHED[dataPointDescriptor.fileName];
    });

    cb();
  });
};

Ddf.prototype.getExpectedConcept = function (type) {
  for (var i = 0; i < concepts.length; i++) {
    if (this.categorizedQuery.other.indexOf(concepts[i].concept) >= 0 &&
      concepts[i].concept_type === type) {
      return concepts[i].concept;
    }
  }

  return null;
};

Ddf.prototype.getTimeConcept = function () {
  return this.getExpectedConcept('time');
};

Ddf.prototype.getEntityDomainConcept = function () {
  return this.getExpectedConcept('entity_domain');
};

// get data points data (for reader)
Ddf.prototype.getDataPoints = function (query, cb) {
  var _this = this;

  _this.getDataPointsContent(query, function () {
    var entityDomainConcept = _this.getEntityDomainConcept();
    var timeConcept = _this.getTimeConcept();

    // fill hash (measure by entity_domain and time)
    _this.dataPointDescriptors.forEach(function (pointDescriptor) {
      pointDescriptor.contentHash = {};

      pointDescriptor.content.forEach(function (record) {
        if (!pointDescriptor.contentHash[record[entityDomainConcept]]) {
          pointDescriptor.contentHash[record[entityDomainConcept]] = {};
        }

        pointDescriptor.contentHash[record[entityDomainConcept]][record[timeConcept]] =
          record[pointDescriptor.measure];
      });
    });

    var result = [];
    // get range for entity_domain
    var entityDomainValues = getExpectedEntityDomainValues(_this.getEntityDomainConcept());
    // get range for time
    var timeRangeValues = getTimeRange(query.where[_this.getTimeConcept()]);

    // fill data points data
    entityDomainValues.forEach(function (entity) {
      timeRangeValues.forEach(function (time) {
        var record = {};

        // record (row)
        record[entityDomainConcept] = entity;
        record[timeConcept] = new Date(time);

        // add measures
        var count = 0;
        _this.dataPointDescriptors.forEach(function (pointDescriptor) {
          if (pointDescriptor.contentHash[entity] && pointDescriptor.contentHash[entity][time]) {
            record[pointDescriptor.measure] = Number(pointDescriptor.contentHash[entity][time]);
            count++;
          }
        });

        if (count === _this.dataPointDescriptors.length) {
          result.push(record);
        }
      });
    });

    cb(result);
  });
};

//// csv utils

var EVALALLOWED = null;

var CACHE = {
  FILE_CACHED: {},
  FILE_REQUESTED: {}
};

function defineEvalAllowed() {
  try {
    new Function("", "");
    EVALALLOWED = true;
  } catch (ignore) {
    // Content-Security-Policy does not allow "unsafe-eval".
    EVALALLOWED = false;
  }
}

// parsing csv string to an object, circumventing d3.parse which uses eval unsafe new Function() which doesn't comply with CSP
// https://developer.chrome.com/apps/contentSecurityPolicy
// https://github.com/mbostock/d3/pull/1910
function csvToObject(res) {
  var header;
  return (res == null) ? null : d3.csv.parseRows(res, function (row, i) {
    if (i) {
      var o = {}, j = -1, m = header.length;
      while (++j < m) o[header[j]] = row[j];
      return o;
    }
    header = row;
  });
}

function load(path) {
  if (CACHE.FILE_REQUESTED[path]) {
    return CACHE.FILE_REQUESTED[path];
  }

  CACHE.FILE_REQUESTED[path] = new Promise();

  // checks if eval() statements are allowed. They are needed for fast parsing by D3.
  if (EVALALLOWED == null) {
    defineEvalAllowed();
  }

  // true:  load using csv, which uses d3.csv.parse, is faster but doesn't comply with CSP
  // false: load using text and d3.csv.parseRows to circumvent d3.csv.parse and comply with CSP
  var loader = (EVALALLOWED) ? d3.csv : d3.text;
  var parser = (EVALALLOWED) ? null : csvToObject;

  loader(path, function (error, res) {

    if (!res) {
      console.log('No permissions or empty file: ' + path, error);
    }

    if (error) {
      console.log('Error Happened While Loading CSV File: ' + path, error);
    }

    if (parser) {
      res = parser(res);
    }

    CACHE.FILE_CACHED[path] = res;
    CACHE.FILE_REQUESTED[path].resolve();
  });

  return CACHE.FILE_REQUESTED[path];
}

//// time utils

function flatten(arr) {
  return arr.reduce(function (prev, cur) {
    var more = [].concat(cur).some(Array.isArray);
    return prev.concat(more ? cur.flatten() : cur);
  }, []);
}

function getUnique(arr) {
  var u = {};
  var a = [];
  for (var i = 0, l = arr.length; i < l; ++i) {
    if (u.hasOwnProperty(arr[i])) {
      continue;
    }

    a.push(arr[i]);
    u[arr[i]] = 1;
  }
  return a;
}

var TIME_TYPE_PATTERN = [
  // year
  /^(\d{4})$/,
  // quarter
  /^(\d{4})q(\d{1})$/,
  // month
  /^(\d{4})(\d{2})$/,
  // week
  /^(\d{4})w(\d{1,2})$/,
  // date
  /^(\d{4})(\d{2})(\d{2})$/
];

function extractLocalTimeRange(type) {
  function parse(option) {
    var match1 = TIME_TYPE_PATTERN[type].exec(option[0]);
    var match2 = TIME_TYPE_PATTERN[type].exec(option[1]);

    return {
      first: [match1[1], match1[2], match1[3]],
      second: [match2[1], match2[2], match2[3]]
    };
  }

  function getTypicalRange(option, minLimit, maxLimit, divider, isFullV) {
    var parsed = parse(option);
    var sYear = Number(parsed.first[0]);
    var v1 = Number(parsed.first[1]);
    var fYear = Number(parsed.second[0]);
    var v2 = Number(parsed.second[1]);

    var result = [];
    for (var year = sYear; year <= fYear; year++) {
      var sV = year === sYear ? v1 : minLimit;
      var fV = year === fYear ? v2 : maxLimit;
      for (var v = sV; v <= fV; v++) {
        if (isFullV === true && v < 10) {
          v = '0' + v;
        }

        result.push(year + divider + v);
      }
    }

    return result;
  }

  var options = [
    function year(option) {
      var parsed = parse(option);
      var sYear = Number(parsed.first[0]);
      var fYear = Number(parsed.second[0]);

      var result = [];
      for (var year = sYear; year <= fYear; year++) {
        result.push('' + year);
      }

      return result;
    },
    function quarter(option) {
      return getTypicalRange(option, 1, 4, 'q', false);
    },
    function month(option) {
      return getTypicalRange(option, 1, 12, '', true);
    },
    function week(option) {
      return getTypicalRange(option, 1, 53, 'w', true);
    },
    function date(option) {
      var parsed = parse(option);
      var sYear = Number(parsed.first[0]);
      var month1 = Number(parsed.first[1]);
      var day1 = Number(parsed.first[2]);
      var fYear = Number(parsed.second[0]);
      var month2 = Number(parsed.second[1]);
      var day2 = Number(parsed.second[2]);

      var result = [];
      for (var year = sYear; year <= fYear; year++) {
        var sMonth = year === sYear ? month1 : 1;
        var fMonth = year === fYear ? month2 : 12;
        for (var month = sMonth; month <= fMonth; month++) {
          var monthStr = month < 10 ? '0' + month : month;
          var sDay = (year === sYear && month === sMonth) ? day1 : 1;
          var fDay = (year === fYear && month === fMonth) ? day2 : 31;

          for (var day = sDay; day <= fDay; day++) {
            var dayStr = day < 10 ? '0' + day : day;

            result.push(year + '' + monthStr + '' + dayStr);
          }
        }
      }

      return result;
    }
  ];

  return options[type];
}

function detectTimeType(timeQuery) {
  var flat = flatten(timeQuery);
  var types = [];
  for (var i = 0; i < flat.length; i++) {
    for (var j = 0; j < TIME_TYPE_PATTERN.length; j++) {
      if (TIME_TYPE_PATTERN[j].test(flat[i])) {
        types.push(j);
        break;
      }
    }
  }

  types = getUnique(types);

  if (types.length !== 1) {
    throw new Error('Wrong time query format: ' + JSON.stringify(timeQuery));
  }

  return types[0];
}

function getTimeRange(query) {
  var type = detectTimeType(query);
  var extractor = extractLocalTimeRange(type);
  var result = [];

  query.forEach(function (option) {
    if (typeof option === 'string') {
      result.push(option);
    }

    if (typeof option === 'object') {
      result = result.concat(extractor(option));
    }
  });

  return result;
}

//// entity set utils

function getExpectedEntityDomainValues(entityName) {
  return entities.map(function (entity) {
    return entity[entityName];
  })
}

export default DDF1CSVReader;
