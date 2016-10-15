import * as utils from 'base/utils';
import Axis from 'axis';

/*
 * VIZABI Size Model
 */

var SizeModel = Axis.extend({

  /**
   * Default values for this model
   */
  _defaults: {
    use: null,
    which: null,
    domainMin: null,
    domainMax: null,
    zoomedMin: null,
    zoomedMax: null,
    extent: null
  },
    
  _type: "size",

  buildScale: function(margins){
    //do whatever axis.buildScale does
    this._super(margins);
    //but then also clamp a numeric scale
    if(this.scaleType !== 'ordinal') this.scale.clamp(true);

    if(this.use == 'indicator' && this.domainMin == null && this.domainMax == null) {
      var domain = this.scale.domain();
      this.set({domainMin: domain[0], domainMax: domain[1]});
    }
  }
});

export default SizeModel;
