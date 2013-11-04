﻿define([
    'text!../template/videoSearchResult.htm',
    'contextMenuGroups',
    'videoSearchResults',
    'streamItems'
], function (VideoSearchResultTemplate, ContextMenuGroups, VideoSearchResults, StreamItems) {
    'use strict';

    var VideoSearchResultView = Backbone.View.extend({
        
        className: 'videoSearchResult',

        template: _.template(VideoSearchResultTemplate),
        
        attributes: function () {
            return {
                'data-videoid': this.model.get('id')
            };
        },
        
        index: -1,
        
        events: {
            'click': 'toggleSelected',
            'click .fa-play': 'play',
            'contextmenu': 'showContextMenu'
        },

        render: function () {

            this.$el.html(this.template(
                _.extend(this.model.toJSON(), {
                    //  Mix in chrome to reference internationalize.
                    'chrome.i18n': chrome.i18n,
                    'index': this.index
                })
            ));

            this.setHighlight();

            return this;
        },
        
        initialize: function (options) {

            this.index = options.index;

            this.listenTo(this.model, 'change:selected', this.setHighlight);
        },
        
        setHighlight: function () {
            this.$el.toggleClass('selected', this.model.get('selected'));
        },
        
        toggleSelected: function () {

            //  A dragged model must always be selected.
            var selected = !this.model.get('selected') || this.model.get('dragging');

            this.model.set('selected', selected);

        },
        
        play: function () {
            
        },
        
        showContextMenu: function (event) {
            var self = this;
            var videoInformation = this.model.get('videoInformation');
            
            event.preventDefault();

            ContextMenuGroups.reset();
            
            ContextMenuGroups.add({
                items: [{
                    text: chrome.i18n.getMessage('play'),
                    onClick: function () {
                        StreamItems.addByVideoInformation(videoInformation, true);
                    }
                }, {
                    text: chrome.i18n.getMessage('add'),
                    onClick: function () {
                        StreamItems.addByVideoInformation(videoInformation, false);
                    }
                }, {
                    text: chrome.i18n.getMessage("copyUrl"),
                    onClick: function () {
                        chrome.extension.sendMessage({
                            method: 'copy',
                            text: 'http://youtu.be/' + self.model.get('id')
                        });
                    }
                }, {
                    text: chrome.i18n.getMessage("copyTitleAndUrl"),
                    onClick: function () {

                        chrome.extension.sendMessage({
                            method: 'copy',
                            text: '"' + self.model.get('title') + '" - http://youtu.be/' + self.model.get('id')
                        });
                    }
                }]
            });

        }
    });

    return VideoSearchResultView;
});