import * as utils from 'base/utils';
import Model from 'base/model';

/*!
 * HOOK MODEL
 */


var Marker = Model.extend({

  /**
   * Gets limits
   * @param {String} attr parameter
   * @returns {Object} limits (min and max)
   * this function is only needed to route the "time" to some indicator, to adjust time start and end to the max and min time available in data
   */
  getLimits: function(attr) {
    if(!this.isHook()) {
      //if there's subhooks, find the one which is an indicator
      var limits = {};
      utils.forEach(this.getSubhooks(), function(s) {
        var prop = (s.use === "property");
        if(!prop) {
          limits = s.getLimits(attr);
          return false;
        }
      });
      return limits;
    }

  },




  /**
   * gets the items associated with this hook without values
   * @param filter filter
   * @returns Array keys
   */
  getKeys: function(filter) {
      var sub = this.getSubhooks();
      var found = [];
      if(sub.length > 1) {
        utils.forEach(sub, function(s) {
          found = s.getKeys();
          return false;
        });
      }
    return found;
  },

    getFrame: function(time) {
      var _this = this;
      var steps = this._parent.time.getAllSteps();

      var cachePath = "";
      utils.forEach(this._dataCube, function(hook, name) {
          cachePath = cachePath + "," + name + ":" + hook.which + " " + _this._parent.time.start + " " + _this._parent.time.end;
      });
      //cachePath = this.getDataManager().getCachePath(this._dataCube);
      return new Promise(function(resolve, reject) {
        if(_this.cachedFrames[cachePath] && _this.cachedFrames[cachePath][time]) {
          resolve(_this.cachedFrames[cachePath][time]);
        } else if (_this.getDataManager().getFrame(cachePath, time) instanceof Promise){
          _this.getDataManager().getFrame(cachePath, time).then(function(frame) {
            resolve(frame);
          });
        } else {
          _this.getFrames().then(function() {
            var pValues, curr = {};
            if(_this.cachedFrames[cachePath][time]) {
              resolve(_this.cachedFrames[cachePath][time]);
            } else if(time < steps[0] || time > steps[steps.length - 1]) {
              //if the requested time point is out of the known range
              //then send nulls in the response
              pValues = this.cachedFrames[cachePath][steps[0]];
              utils.forEach(pValues, function(keys, hook) {
                curr[hook] = {};
                utils.forEach(keys, function(val, key) {
                  curr[hook][key] = null;
                });
              });
              resolve(curr);
            } else {
              var next = d3.bisectLeft(steps, time);

              if(next === 0) {
                resolve(_this.cachedFrames[cachePath][steps[0]]);
              } else {
                var fraction = (time - steps[next - 1]) / (steps[next] - steps[next - 1]);

                pValues = _this.cachedFrames[cachePath][steps[next - 1]];
                var nValues = _this.cachedFrames[cachePath][steps[next]];

                utils.forEach(pValues, function(values, hook) {
                  curr[hook] = {};
                  utils.forEach(values, function(val, id) {
                    var val2 = nValues[hook][id];
                    curr[hook][id] = (!utils.isNumber(val)) ? val : val + ((val2 - val) *
                    fraction);
                  });
                });
                resolve(curr);
              }
            }
          });
        }
      });
    },

    getFrames: function() {
      var _this = this;

      var cachePath = "";
      utils.forEach(this._dataCube, function(hook, name) {
          cachePath = cachePath + "," + name + ":" + hook.which + " " + _this._parent.time.start + " " + _this._parent.time.end;
      });

      var steps = this._parent.time.getAllSteps();
      var result = {};

      this._dataCube = this._dataCube || this.getSubhooks(true);
      return new Promise(function(resolve, reject) {
        // Assemble the list of keys as an intersection of keys in all queries of all hooks

        var resultKeys = _this.getKeys().map(function(val) {
          return val[Object.keys(val)[0]];
        });
        steps.forEach(function(t) {
          result[t] = {};
        });
        var promisesLength = 0;
        utils.forEach(_this._dataCube, function(hook, name) {
          if(hook.use === "constant") {
            steps.forEach(function(t) {
              result[t][name] = {};
              resultKeys.forEach(function(key) {
                result[t][name][key] = hook.which;
              });
            });

          } else if(hook.which === "geo") {
            steps.forEach(function(t) {
              result[t][name] = {};
              resultKeys.forEach(function(key) {
                result[t][name][key] = key;
              });
            });

          } else if(hook.which === "time") {
            steps.forEach(function(t) {
              result[t][name] = {};
              resultKeys.forEach(function(key) {
                result[t][name][key] = new Date(t);
              });
            });

          } else {
            ++promisesLength;
            _this.getDataManager().getFrames(hook._dataId, steps).then(function(response) {
              utils.forEach(response, function(frame, t) {
                result[t][name] = frame[hook.which];
              });
              _this.cachedFrames[cachePath] = result;
              if (--promisesLength == 0) {
                resolve(result);
              }
            });
          }
          if (promisesLength == 0) { // we have no pending promises resolve data
            _this.cachedFrames[cachePath] = result;
            resolve(result);
          }
        });
      });
    },



  /**
   * gets multiple values from the hook
   * @param {Object} filter Reference to the row. e.g: {geo: "swe", time: "1999", ... }
   * @param {Array} group_by How to nest e.g: ["geo"]
   * @param {Boolean} [previous = false] previous Append previous data points
   * @returns an array of values
   */
  getValues: function(filter, group_by, previous) {
    var _this = this;

    if(this.isHook()) {
      return [];
    }

    var dimTime, time, filtered, next, u, w, value, method;
    this._dataCube = this._dataCube || this.getSubhooks(true);
    filter = utils.clone(filter, this._getAllDimensions());
    dimTime = this._getFirstDimension({
      type: 'time'
    });
    time = new Date(filter[dimTime]); //clone date
    filter = utils.clone(filter, null, dimTime);

    var response = {};
    var f_keys = Object.keys(filter);
    var f_values = f_keys.map(function(k) {
      return filter[k];
    });

    //if there's a filter, interpolate only that
    if(f_keys.length) {
      utils.forEach(this._dataCube, function(hook, name) {
        u = hook.use;
        w = hook.which;

        if(hook.use !== "property") next = next || d3.bisectLeft(hook.getUnique(dimTime), time);

        method = hook.getMetadata().interpolation;
        filtered = _this.getDataManager().get(hook._dataId, 'nested', f_keys);
        utils.forEach(f_values, function(v) {
          filtered = filtered[v]; //get precise array (leaf)
        });
        value = utils.interpolatePoint(filtered, u, w, next, dimTime, time, method);
        response[name] = hook.mapValue(value);

        //concat previous data points
        if(previous) {
          var values = utils.filter(filtered, filter).filter(function(d) {
            return d[dimTime] <= time;
          }).map(function(d) {
            return hook.mapValue(d[w]);
          }).concat(response[name]);
          response[name] = values;
        }
      });
    }
    //else, interpolate all with time
    else {
      utils.forEach(this._dataCube, function(hook, name) {

        filtered = _this.getDataManager().get(hook._dataId, 'nested', group_by);

        response[name] = {};
        //find position from first hook
        u = hook.use;
        w = hook.which;

        if(hook.use !== "property") next = (typeof next === 'undefined') ? d3.bisectLeft(hook.getUnique(dimTime), time) : next;

        method = hook.getMetadata().interpolation;


        utils.forEach(filtered, function(arr, id) {
          //TODO: this saves when geos have different data length. line can be optimised.
          next = d3.bisectLeft(arr.map(function(m){return m.time}), time);

          value = utils.interpolatePoint(arr, u, w, next, dimTime, time, method);
          response[name][id] = hook.mapValue(value);

          //concat previous data points
          if(previous) {
            var values = utils.filter(arr, filter).filter(function(d) {
              return d[dimTime] <= time;
            }).map(function(d) {
              return hook.mapValue(d[w]);
            }).concat(response[name][id]);
            response[name][id] = values;
          }

        });
      });
    }

    return response;
  },

  /**
   * Gets the metadata of all hooks
   * @returns {Object} metadata
   */
  getMetadata: function() {
    return this.getDataManager().getMetadata();
  },

  /**
   * Gets the metadata of all hooks
   * @returns {Object} metadata
   */
  getIndicatorsTree: function() {
    return this.getDataManager().getIndicatorsTree();
  }


});

export default Marker;
