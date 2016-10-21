import * as utils from 'base/utils';
import Tool from 'base/tool';

import BarRankChartComponent from './barrankchart-component';
import {
  timeslider,
  dialogs,
  buttonlist,
  treemenu
} from 'components/_index';

var BarRankChart = Tool.extend('BarRankChart', {

  //Run when the tool is created
  init: function(placeholder, external_model) {

    this.name = "barrankchart";

    this.components = [{
      component: BarRankChartComponent, 
      placeholder: '.vzb-tool-viz', 
      model: ["state.time", "state.entities", "state.marker", "language", "ui"] 
    }, {
      component: timeslider,
      placeholder: '.vzb-tool-timeslider',
      model: ["state.time", "state.entities", "state.marker"]
    }, {
      component: dialogs,
      placeholder: '.vzb-tool-dialogs',
      model: ['state', 'ui', 'language']
    }, {
      component: buttonlist,
      placeholder: '.vzb-tool-buttonlist',
      model: ['state', 'ui', 'language']
    }, {
      component: treemenu,
      placeholder: '.vzb-tool-treemenu',
      model: ['state.marker', 'state.marker_tags', 'state.time', 'language']
    }];

    //constructor is the same as any tool
    this._super(placeholder, external_model);
  },



  /**
   * Determines the default model of this tool
   */
  default_model: {
    state: { 
      time: {
      },
      marker: {
        axis_x: {allow: {scales: ["linear","log"]}},
        axis_y: {allow: {scales: ["ordinal"]}},
        color:  { }
      }
    },
    language: { },
    ui: {
      presentation: false,
      chart: { }
    }
  }
});

export default BarRankChart;