﻿define([
    'foreground/view/genericForegroundView',
    'foreground/view/videoSearch/videoSearchResultsView',
    'text!template/videoSearch.html',
    'foreground/view/videoSearch/playSelectedButtonView',
    'foreground/view/videoSearch/saveSelectedButtonView',
    'foreground/collection/videoSearchResults'
], function (GenericForegroundView, VideoSearchResultsView, VideoSearchTemplate, PlaySelectedButtonView, SaveSelectedButtonView, VideoSearchResults) {
    'use strict';

    var VideoSearchView = GenericForegroundView.extend({
        
        className: 'left-pane',
        
        template: _.template(VideoSearchTemplate),
        
        videoSearchResultsView: null,
        
        attributes: {
            id: 'videoSearch'
        },
        
        searchUnderline: null,
        playSelectedButtonView: new PlaySelectedButtonView(),
        saveSelectedButtonView: new SaveSelectedButtonView(),
        
        searchingMessage: null,
        instructions: null,
        noResultsMessage: null,
        
        events: {
            'focus .searchBar input': 'highlight',
            'blur .searchBar input': 'lowlight',
            'input .searchBar input': 'showVideoSuggestions',
            'click #button-back': 'destroyModel'
        },

        render: function () {
            this.$el.html(this.template(
                _.extend(this.model.toJSON(), {
                    //  Mix in chrome to reference internationalize.
                    'chrome.i18n': chrome.i18n
                })
            ));

            this.$el.find('#videoSearchResultsView').replaceWith(this.videoSearchResultsView.render().el);

            var playlistActions = this.$el.find('.playlist-actions');

            playlistActions.append(this.playSelectedButtonView.render().el);
            playlistActions.append(this.saveSelectedButtonView.render().el);

            this.searchUnderline = $('.searchBar .underline');

            this.initializeTooltips();
            
            this.searchingMessage = this.$el.find('div.searching');
            this.instructions = this.$el.find('div.instructions');
            this.noResultsMessage = this.$el.find('div.noResults');

            this.toggleBigText();
            
            return this;
        },
        
        initialize: function () {

            this.videoSearchResultsView = new VideoSearchResultsView();
            this.listenTo(this.model, 'destroy', this.hide);
            this.listenTo(this.model, 'change:searchJqXhr', this.toggleBigText);
            this.listenTo(VideoSearchResults, 'reset', this.toggleBigText);
        },
        
        highlight: function() {
            this.searchUnderline.addClass('active');
        },
        
        lowlight: function() {
            this.searchUnderline.removeClass('active');
        },
        
        showAndFocus: function (instant) {
            
            this.$el.transition({
                x: this.$el.width()
            }, instant ? 0 : undefined, 'snap');

            var searchInput = $('.searchBar input');
            searchInput.focus();
        },
        
        destroyModel: function () {
            this.model.destroy();
        },
        
        hide: function() {
            var self = this;
    
            this.$el.transition({
                x: -20
            }, function () {
                self.remove();
                VideoSearchResults.clear();
            });
           
        },
        
        getSearchQuery: function () {
            var searchInput = $('.searchBar input');
            var searchQuery = $.trim(searchInput.val());

            return searchQuery;
        },
        
        //  Searches youtube for video results based on the given text.
        showVideoSuggestions: function () {
            var searchQuery = this.getSearchQuery();

            this.model.set('searchQuery', searchQuery);
        },

        //  Set the visibility of any visible text messages.
        toggleBigText: function () {
            //  Hide the search message when not searching.
            var isNotSearching = this.model.get('searchJqXhr') === null;
            this.searchingMessage.toggleClass('hidden', isNotSearching);
            
            //  Hide the instructions message once user has searched or are searching.
            var hasSearchResults = VideoSearchResults.length > 0;
            var hasSearchQuery = this.model.get('searchQuery').length > 0;
            this.instructions.toggleClass('hidden', hasSearchResults || hasSearchQuery);

            //  Only show no results when all other options are exhausted and user has interacted.
            var hasNoResults = isNotSearching && hasSearchQuery && !hasSearchResults;
            this.noResultsMessage.toggleClass('hidden',  !hasNoResults);
        }

    });

    return VideoSearchView;
});