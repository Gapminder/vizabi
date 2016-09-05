import * as utils from 'base/utils';
import Component from 'base/component';
import Dialog from '../_dialog';

import { colorlegend, indicatorpicker } from 'components/_index'

/*!
 * VIZABI COLOR DIALOG
 */

var Colors = Dialog.extend({

  /**
   * Initializes the dialog component
   * @param config component configuration
   * @param context component context (parent)
   */
  init: function(config, parent) {
    this.name = 'colors';

    this.components = [{
      component: indicatorpicker,
      placeholder: '.vzb-caxis-selector',
      model: ["state.time", "state.entities", "state.marker", "language"],
      markerID: "color",
      showHoverValues: true
    }, {
      component: colorlegend,
      placeholder: '.vzb-clegend-container',
      model: ["state", "language"]
    }];


    this._super(config, parent);
  }

});

export default Colors;