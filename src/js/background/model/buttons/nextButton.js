﻿define([
    'background/collection/streamItems',
    'background/model/buttons/radioButton',
    'background/model/buttons/shuffleButton',
    'background/model/buttons/repeatButton',
    'enum/repeatButtonState'
], function (StreamItems, RadioButton, ShuffleButton, RepeatButton, RepeatButtonState) {
    'use strict';

    var NextButton = Backbone.Model.extend({
        
        defaults: {
            enabled: false
        },
        
        initialize: function () {
            
            this.listenTo(StreamItems, 'add addMultiple remove empty change:selected', this.toggleEnabled);
            this.listenTo(RadioButton, 'change:enabled', this.toggleEnabled);
            this.listenTo(ShuffleButton, 'change:enabled', this.toggleEnabled);
            this.listenTo(RepeatButton, 'change:state', this.toggleEnabled);

            this.toggleEnabled();
        },
        
        toggleEnabled: function () {

            var enabled = false;
            
            if (StreamItems.length > 0) {

                var radioEnabled = RadioButton.get('enabled');
                var shuffleEnabled = ShuffleButton.get('enabled');
                var repeatButtonState = RepeatButton.get('state');

                //  You can skip with shuffle enabled if there are multiple items to shuffle between.
                if (shuffleEnabled && StreamItems.length > 1) {
                    enabled = true;
                }
                //  You can always continue if radio is enabled or if repeating is enabled
                else if (radioEnabled || repeatButtonState !== RepeatButtonState.Disabled) {
                    enabled = true;
                } else {
                    //  Enable only if there are more items to skip to.
                    var selectedItemIndex = StreamItems.indexOf(StreamItems.findWhere({ selected: true }));

                    if (selectedItemIndex + 1 !== StreamItems.length) {
                        enabled = true;
                    }

                }

            }

            this.set('enabled', enabled);

        },
        
        //  Prevent spamming by only allowing a next click once every 100ms.
        trySelectNextVideo: _.debounce(function () {

            if (this.get('enabled')) {
                StreamItems.selectNext();
            }

            return this.get('enabled');

        }, 100, true)

    });

    //  Exposed globally so that the foreground can access the same instance through chrome.extension.getBackgroundPage()
    window.NextButton = new NextButton();
    return window.NextButton;
});