﻿define([
    'background/notifications',
    'background/model/streamItem',
    'background/model/video',
    'background/model/player',
    'background/model/buttons/shuffleButton',
    'background/model/buttons/radioButton',
    'background/model/buttons/repeatButton',
    'enum/repeatButtonState',
    'enum/playerState',
    'common/model/utility',
    'common/model/youTubeV2API'
], function (Notifications, StreamItem, Video, Player, ShuffleButton, RadioButton, RepeatButton, RepeatButtonState, PlayerState, Utility, YouTubeV2API) {
    'use strict';

    var StreamItems = Backbone.Collection.extend({
        model: StreamItem,

        initialize: function () {
            //  TODO: Probably make a stream model instead of extending streamItems
            //  Give StreamItems a history: https://github.com/jashkenas/backbone/issues/1442
            _.extend(this, { history: [] });
            _.extend(this, { bannedVideoIdList: [] });

            var self = this;

            this.on('add', function (addedStreamItem) {
                //  Ensure only one streamItem is selected at a time by de-selecting all other selected streamItems.
                if (addedStreamItem.get('selected')) {
                    addedStreamItem.trigger('change:selected', addedStreamItem, true);
                }

                //  If the Stream has any items in it, one should be selected.
                if (self.length === 1) {
                    addedStreamItem.set('selected', true);
                }

                var videoId = addedStreamItem.get('video').get('id');

                //  TODO: Why is this done here? Probably should be done in a constructor for StreamItem?
                YouTubeV2API.getRelatedVideoInformation({
                    videoId: videoId,
                    success: function (relatedVideoInformation) {

                        if (relatedVideoInformation == null) throw "Related video information not found." + videoId;
                        addedStreamItem.set('relatedVideoInformation', relatedVideoInformation);
                    },
                    error: function() {
                        //  TODO: Do something with error? Notify user?
                    }
                });

            });

            this.on('addMultiple', function(addedStreamItems) {

                var selectedStreamItem = _.find(addedStreamItems, function(streamItem) {
                    return streamItem.get('selected');
                });

                //  If a selected item is added -- manually trigger a selected event to deselect all other items.
                if (selectedStreamItem !== undefined) {
                    selectedStreamItem.trigger('change:selected', selectedStreamItem, true);
                }
                //  If no selected item was added, and no pre-existing items, ensure at least one is selected;
                else if (self.length === addedStreamItems.length) {
                    addedStreamItems[0].set('selected', true);
                }

            });

            this.on('change:selected', function(changedStreamItem, selected) {

                //  Ensure only one streamItem is selected at a time by de-selecting all other selected streamItems.
                if (selected) {
                    this.deselectAllExcept(changedStreamItem.cid);

                    var videoId = changedStreamItem.get('video').get('id');

                    //  Maintain the state of the player by playing or cueuing based on current player state.
                    var playerState = Player.get('state');

                    //  TODO: Maybe ended here isn't right if they had only 1 item in the playlist and then add another with the first ended.
                    if (playerState === PlayerState.Playing || playerState === PlayerState.Ended) {
                        Player.loadVideoById(videoId);
                    } else {
                        Player.cueVideoById(videoId);
                    }
                }

            });

            this.listenTo(Player, 'change:state', function (model, state) {
                
                if (state === PlayerState.Ended) {
                    this.selectNext();
                }
                else if (state === PlayerState.Playing) {

                    //  Only display notifications if the foreground isn't open.
                    var foreground = chrome.extension.getViews({ type: "popup" });

                    if (foreground.length === 0) {

                        //  If the foreground UI is not open, show a notification to indicate active video.
                        var selectedItem = this.getSelectedItem();
                        var activeVideoId = selectedItem.get('video').get('id');

                        Notifications.showNotification({
                            iconUrl: 'http://img.youtube.com/vi/' + activeVideoId + '/default.jpg',
                            title: 'Now Playing',
                            message: selectedItem.get('title')
                        });

                    }
                }

            });

            this.on('empty', function () {
                Player.stop();
            });

            this.on('remove', function (removedStreamItem, collection, options) {

                if (this.length === 0) {
                    this.trigger('empty');
                }

                if (removedStreamItem.get('selected') && this.length > 0) {
                    this.selectNext(options.index);
                }
            });

            this.on('change:playedRecently', function() {

                //  When all streamItems have been played recently, reset to not having been played recently.
                //  Allows for de-prioritization of played streamItems during shuffling.
                console.log("PlayedRecently length:", this.where({ playedRecently: true }), this.length);
                if (this.where({ playedRecently: true }).length === this.length) {
                    this.each(function(streamItem) {
                        streamItem.set('playedRecently', false);
                    });
                }

            });
            
            //  Beatport can send messages to add stream items and play directly if user has clicked on a button.
            chrome.runtime.onMessage.addListener(function (request) {
                
                switch (request.method) {
                    case 'searchAndStreamByQuery':
                        self.searchAndAddByName(request.query, true);
                    break;

                    case 'searchAndStreamByQueries':
                        var queries = request.queries;

                        if (queries.length > 0) {
                            
                            var query = queries.shift();

                            var recursiveShiftVideoTitleAndAdd = function () {
                                
                                if (queries.length > 0) {
                                    query = queries.shift();
                                    self.searchAndAddByName(query, false, recursiveShiftVideoTitleAndAdd);
                                }
                                
                            };

                            self.searchAndAddByName(query, true, function () {
                                recursiveShiftVideoTitleAndAdd();
                            });
                            
                        }
                    break;
                }

            });

        },
        
        searchAndAddByName: function(videoTitle, playOnAdd, callback) {
            var self = this;
            
            YouTubeV2API.search({
                text: videoTitle,
                maxResults: 10,
                success: function (videoInformationList) {

                    if (videoInformationList.length === 0) {
                        console.error("Failed to find any videos for:", videoTitle);
                    } else {

                        var video = new Video({
                            videoInformation: videoInformationList[0]
                        });
                        
                        self.addByVideo(video, !!playOnAdd);

                    }

                    if (callback) {
                        callback();
                    }
                }
            });
        },
        
        addByPlaylist: function (playlist, playOnAdd) {

            var videos = playlist.get('items').pluck('video');
            
            if (videos.length === 1) {
                this.addByVideo(videos[0], playOnAdd);
            } else {
                this.addByVideos(videos, playOnAdd);
            }
            
        },
        
        addByDraggedPlaylistItem: function(playlistItem, index) {
          
            this.add({
                id: _.uniqueId('streamItem_'),
                video: playlistItem.get('video'),
                title: playlistItem.get('title')
            }, {
                at: index
            });
            
        },
        
        addByPlaylistItem: function(playlistItem, playOnAdd) {
            if (playOnAdd) {
                Player.playOnceVideoChanges();
            }
            
            this.add({
                id: _.uniqueId('streamItem_'),
                video: playlistItem.get('video'),
                title: playlistItem.get('title'),
                //  Select and play the first added item if playOnAdd is set to true
                selected: playOnAdd
            });
        },
        
        addByVideo: function (video, playOnAdd) {
            
            if (playOnAdd) {
                Player.playOnceVideoChanges();
            }
            
            this.add({
                id: _.uniqueId('streamItem_'),
                video: video,
                title: video.get('title'),
                //  Select and play the first added item if playOnAdd is set to true
                selected: playOnAdd
            });

        },
        
        addByVideos: function (videos, playOnAdd) {
            
            if (!_.isArray(videos)) {
                return this.addByVideo(videos, playOnAdd);
            }

            if (playOnAdd) {
                Player.playOnceVideoChanges();
            }
            
            var streamItems = _.map(videos, function (video, iterator) {

                return new StreamItem({
                    id: _.uniqueId('streamItem_'),
                    video: video,
                    title: video.get('title'),
                    //  Select and play the first added item if playOnAdd is set to true
                    selected: playOnAdd && iterator === 0
                });
                
            });

            this.addMultiple(streamItems);
        },

        addMultiple: function(streamItems) {

            //  Handling this manually to not clog the network with getVideoInformation requests
            this.add(streamItems, { silent: true });

            var self = this;
            
            //  Fetch from collection to make sure references stay correct + leverage conversion to model
            var streamItemsFromCollection = _.map(streamItems, function (streamItem) {
                var streamItemId;

                if (streamItem instanceof Backbone.Model) {
                    streamItemId = streamItem.get('id');
                } else {
                    streamItemId = streamItem.id;
                }

                return self.get(streamItemId);
            });
            
            var selectedStreamItem = this.getSelectedItem();

            if (selectedStreamItem === null) {
                //  If the Stream has any items in it, one should be selected.
                this.at(0).set('selected', true);
            }

            //  Take a statistically significant sample of the videos added and fetch their relatedVideo information.
            var sampleSize = streamItemsFromCollection.length >= 50 ? 50 : streamItemsFromCollection.length;

            //  Get X samples from an array from 0 to N which has been randomized 
            var randomSampleIndices = _.shuffle(_.range(streamItemsFromCollection.length)).slice(sampleSize);

            var randomVideoIds = _.map(randomSampleIndices, function (randomSampleIndex) {
                return streamItemsFromCollection[randomSampleIndex].get('video').get('id');
            });

            //  Fetch all the related videos for videos on load.
            //  Data won't appear immediately as it is an async request, I just want to get the process started now.
            YouTubeV2API.getBulkRelatedVideoInformation(randomVideoIds, function (bulkInformationList) {

                _.each(bulkInformationList, function (bulkInformation) {
                    var videoId = bulkInformation.videoId;

                    var streamItem = _.find(streamItemsFromCollection, function (streamItemFromCollection) {
                        return streamItemFromCollection.get('video').get('id') === videoId;
                    });

                    streamItem.set('relatedVideoInformation', bulkInformation.relatedVideoInformation);

                });

            });

            this.trigger('addMultiple', streamItemsFromCollection);
        },

        deselectAllExcept: function(streamItemCid) {

            this.each(function(streamItem) {

                if (streamItem.cid != streamItemCid) {
                    streamItem.set('selected', false);
                }

            });

        },

        getSelectedItem: function () {
            return this.findWhere({ selected: true }) || null;
        },
        
        //  TODO: Change getRelatedVideos into a property so I can watch for relatedVideos existing.
        //  Take each streamItem's array of related videos, pluck them all out into a collection of arrays
        //  then flatten the arrays into a collection of videos.
        getRelatedVideos: function() {

            //  Find all streamItem entities which have related video information.
            //  Some might not have information. This is OK. Either YouTube hasn't responded yet or responded with no information. Skip these.
            var streamItemsWithInfo = this.filter(function (streamItem) {
                return streamItem.get('relatedVideoInformation') != null;
            });

            //  Create a list of all the related videos from all of the information of stream items.
            var relatedVideos = _.flatten(_.map(streamItemsWithInfo, function (streamItem) {

                return _.map(streamItem.get('relatedVideoInformation'), function (relatedVideoInformation) {

                    return new Video({
                        videoInformation: relatedVideoInformation
                    });

                });

            }));

            //  Don't add any videos that are already in the stream.
            var self = this;

            relatedVideos = _.filter(relatedVideos, function (relatedVideo) {
                var alreadyExistingItem = self.find(function (streamItem) {

                    var sameVideoId = streamItem.get('video').get('id') === relatedVideo.get('id');
                    var sameCleanTitle = streamItem.get('video').get('cleanTitle') === relatedVideo.get('cleanTitle');

                    var inBanList = _.contains(self.bannedVideoIdList, relatedVideo.get('id'));

                    return sameVideoId || sameCleanTitle || inBanList;
                });

                return alreadyExistingItem == null;
            });

            // Try to filter out 'playlist' songs, but if they all get filtered out then back out of this assumption.
            var tempFilteredRelatedVideos = _.filter(relatedVideos, function (relatedVideo) {
                //  assuming things >8m are playlists.
                var isJustOneSong = relatedVideo.get('duration') < 480;
                var isNotLive = relatedVideo.get('title').toLowerCase().indexOf('live') === -1;

                return isJustOneSong && isNotLive;
            });

            if (tempFilteredRelatedVideos.length !== 0) {
                relatedVideos = tempFilteredRelatedVideos;
            }

            return relatedVideos;
        },

        getRandomRelatedVideo: function() {

            var relatedVideos = this.getRelatedVideos();
            var relatedVideo = relatedVideos[_.random(relatedVideos.length - 1)] || null;
            
            return relatedVideo;
        },
        
        //  If a streamItem which was selected is removed, selectNext will have a removedSelectedItemIndex provided
        selectNext: function(removedSelectedItemIndex) {

            var shuffleEnabled = ShuffleButton.get('enabled');
            var radioEnabled = RadioButton.get('enabled');
            var repeatButtonState = RepeatButton.get('state');

            //  If removedSelectedItemIndex is provided, RepeatButtonState -> Video doesn't matter because the video was just deleted.
            if (removedSelectedItemIndex === undefined && repeatButtonState === RepeatButtonState.RepeatVideo) {
                var selectedItem = this.findWhere({ selected: true });
                selectedItem.trigger('change:selected', selectedItem, true);
            } else if (shuffleEnabled) {

                var shuffledItems = _.shuffle(this.where({ playedRecently: false }));
                shuffledItems[0].set('selected', true);
            } else {

                var nextItemIndex;

                if (removedSelectedItemIndex !== undefined && removedSelectedItemIndex !== null) {
                    nextItemIndex = removedSelectedItemIndex;
                } else {
                    nextItemIndex = this.indexOf(this.findWhere({ selected: true })) + 1;
                    if (nextItemIndex <= 0) throw "Failed to find nextItemIndex";
                }

                //  Select the next item by index. Potentially loop around to the front.
                if (nextItemIndex === this.length) {

                    if (repeatButtonState === RepeatButtonState.RepeatStream) {
                        this.at(0).set('selected', true);

                        //  TODO: Might be sending an erroneous trigger on delete?
                        //  Only one item in the playlist and it was already selected, resend selected trigger.
                        if (this.length === 1) {
                            this.at(0).trigger('change:selected', this.at(0), true);
                        }
                    } else if (radioEnabled) {

                        var randomRelatedVideo = this.getRandomRelatedVideo();

                        if (randomRelatedVideo === null) {

                            console.error("No related video found.");

                        } else {

                            this.add({
                                video: randomRelatedVideo,
                                title: randomRelatedVideo.get('title'),
                                selected: true
                            });

                        }

                    } else {

                        //  Select the first item in the playlist and then pause the player because playlist looping shouldn't continue.
                        this.at(0).set('selected', true);
                        Player.pause();
                    }

                } else {
                    this.at(nextItemIndex).set('selected', true);
                }

            }

        },

        selectPrevious: function() {

            //  Peel off currentStreamItem from the top of history.
            this.history.shift();
            var previousStreamItem = this.history.shift();

            //  If no previous item was found in the history, then just go back one item
            if (previousStreamItem == null) {

                var shuffleEnabled = ShuffleButton.get('enabled');
                var repeatButtonState = RepeatButton.get('state');

                if (repeatButtonState === RepeatButtonState.RepeatVideo) {
                    var selectedItem = this.findWhere({ selected: true });
                    selectedItem.trigger('change:selected', selectedItem, true);
                } else if (shuffleEnabled) {

                    var shuffledItems = _.shuffle(this.where({ playedRecently: false }));
                    shuffledItems[0].set('selected', true);

                } else {
                    //  Select the previous item by index. Potentially loop around to the back.
                    var selectedItemIndex = this.indexOf(this.findWhere({ selected: true }));

                    if (selectedItemIndex === 0) {

                        if (repeatButtonState === RepeatButtonState.RepeatStream) {
                            this.at(this.length - 1).set('selected', true);
                        }

                    } else {
                        this.at(selectedItemIndex - 1).set('selected', true);
                    }

                }

            } else {
                previousStreamItem.set('selected', true);
            }
        },
        
        ban: function (streamItem) {
            this.bannedVideoIdList.push(streamItem.get('video').get('id'));
        },
        
        clear: function () {
            this.bannedVideoIdList = [];
            this.reset();
            this.trigger('empty');
        }
    });
    
    //  Exposed globally so that the foreground can access the same instance through chrome.extension.getBackgroundPage()
    window.StreamItems = new StreamItems();
    return window.StreamItems;
});