/*
 * Copyright 2016-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* jshint node: true, devel: true */
'use strict';

const bodyParser = require('body-parser');
const config = require('config');
const crypto = require('crypto');
const express = require('express');
const https = require('https');
const request = require('request');
const database = require('./models/database');

var app = express();
app.set('port', process.env.PORT || 5000);
app.set('view engine', 'ejs');
app.use(bodyParser.json({ verify: verifyRequestSignature }));
app.use(express.static('public'));

/*
 * Be sure to setup your config values before running this code. You can 
 * set them using environment variables or modifying the config file in /config.
 */

// App Secret can be retrieved from the Facebook App Dashboard
const APP_SECRET = (process.env.MESSENGER_APP_SECRET) ? 
  process.env.MESSENGER_APP_SECRET :
  config.get('appSecret');

// Arbitrary value used to validate a webhook
const VALIDATION_TOKEN = (process.env.MESSENGER_VALIDATION_TOKEN) ?
  (process.env.MESSENGER_VALIDATION_TOKEN) :
  config.get('validationToken');

// Generate a page access token for your page from the App Dashboard
const PAGE_ACCESS_TOKEN = (process.env.MESSENGER_PAGE_ACCESS_TOKEN) ?
  (process.env.MESSENGER_PAGE_ACCESS_TOKEN) :
  config.get('pageAccessToken');

// URL where the app is running (include protocol). Used to point to scripts and 
// assets located at this address. 
const SERVER_URL = (process.env.SERVER_URL) ?
  (process.env.SERVER_URL) :
  config.get('serverURL');

// Check all require config values exist.
if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN && SERVER_URL)) {
  console.error("Missing config values");
  process.exit(1);
}

app.get('/webhook', function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === VALIDATION_TOKEN) {
    console.log("Validating webhook");
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);          
  }  
});

app.post('/webhook', function (req, res) {
  var data = req.body;

  // Make sure this is a page subscription
  if (data.object == 'page') {
    // Iterate over each entry
    // There may be multiple if batched
    data.entry.forEach(function(pageEntry) {
      var pageID = pageEntry.id;
      var timeOfEvent = pageEntry.time;

      // Iterate over each messaging event
      pageEntry.messaging.forEach(function(messagingEvent) {
        if (messagingEvent.message) {
          receivedMessage(messagingEvent);
        } else if (messagingEvent.postback) {
          receivedPostback(messagingEvent);
        } else {
          console.log("Webhook received unknown messagingEvent: ", messagingEvent);
        }
      });
    });

    // Return 200 within 20 seconds to let platform know
    // that app has recieved request and prevent timeout.
    res.sendStatus(200);
  }
});

function verifyRequestSignature(req, res, buf)
{
  var signature = req.headers["x-hub-signature"];

  if (!signature)
  {
    throw new Error("Couldn't validate the signature.");
  }
  else
  {
    var elements = signature.split('=');
    var method = elements[0];
    var signatureHash = elements[1];

    var expectedHash = crypto.createHmac('sha1', APP_SECRET)
                        .update(buf)
                        .digest('hex');

    if (signatureHash != expectedHash)
    {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}

/**
 * Callback function called when server recieves a facebook message data.
 * Message may be an echo of a previously sent server message which is used to
 * queue messages.
 */
function receivedMessage(event)
{
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;

  console.log("Received message for user %d and page %d at %d with message:", senderID, recipientID, timeOfMessage);
  console.log(JSON.stringify(message));

  var isEcho = message.is_echo;
  var messageId = message.mid;
  var appId = message.app_id;
  var metadata = message.metadata;

  var messageText = message.text;
  var messageAttachments = message.attachments;
  var quickReply = message.quick_reply;

  if (isEcho)
  {
    console.log("Received echo for message %s and app %d with metadata %s", messageId, appId, metadata);
    userIdToLastSentTimestamp[recipientID] = 0;
    sendNextMessage(recipientID);
  }
  else if (quickReply)
  {
    var quickReplyPayload = quickReply.payload;
    console.log("Quick reply for message %s with payload %s", messageId, quickReplyPayload);
  }
  else if (messageText)
  {
    doNextAction(senderID, event);
  }
  else if (messageAttachments)
  {
    doNextAction(senderID, event);
  }
}

/**
 * Callback function to handle postbacks for user options.
 */
function receivedPostback(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfPostback = event.timestamp;

  // The 'payload' param is a developer-defined field which is set in a postback 
  // button for Structured Messages. 
  var payload = event.postback.payload;
  
  if(payload == "mood-option-1")
  {
    setTargetMood(senderID, 1, function(){doNextAction(senderID, event);});
  }
  else if(payload == "mood-option-2")
  {
    setTargetMood(senderID, 2, function(){doNextAction(senderID, event);});
  }
  else if(payload == "mood-option-3")
  {
    setTargetMood(senderID, 3, function(){doNextAction(senderID, event);});
  }
  else if(payload == "location-option-1")
  {
    setTargetLocation(senderID, 1, function(){doNextAction(senderID, event);});
  }
  else if(payload == "location-option-2")
  {
    setTargetLocation(senderID, 2, function(){doNextAction(senderID, event);});
  }
  else if(payload == "location-option-3")
  {
    setTargetLocation(senderID, 3, function(){doNextAction(senderID, event);});
  }

  console.log("Received postback for user %d and page %d with payload '%s' " + "at %d", senderID, recipientID, payload, timeOfPostback);
}

/*
 * Dispatches the message data via the Send API
 */
function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      if (messageId) {
        console.log("Successfully sent message with id %s to recipient %s", 
          messageId, recipientId);
      } else {
      console.log("Successfully called Send API for recipient %s", 
        recipientId);
      }
    } else {
      console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
    }
  });  
}

/**
 * Adds the given message data to the queue for the recipient with the given
 * recipientId This prevents messages from being recieved by the user in an
 * incorrect order.
 */
function addMessageToQueue(recipientId, messageData)
{
  if(userIdToMessagesQueue.hasOwnProperty(recipientId))
  {
    userIdToMessagesQueue[recipientId].push(messageData);
  }
  else
  {
    userIdToMessagesQueue[recipientId] = [messageData];
  }
  
  if(!userIdToLastSentTimestamp.hasOwnProperty(recipientId) ||
     userIdToLastSentTimestamp[recipientId] == 0 ||
     userIdToLastSentTimestamp[recipientId] + timeoutInMilliseconds < Date.now())
  {
    sendNextMessage(recipientId);
  }
}

/**
 * Sends the next message in the user's queue to the user.
 */
function sendNextMessage(recipientId)
{
  if(!userIdToLastSentTimestamp.hasOwnProperty(recipientId) ||
     userIdToLastSentTimestamp[recipientId] == 0 ||
     userIdToLastSentTimestamp[recipientId] + timeoutInMilliseconds < Date.now())
  {
    if(userIdToMessagesQueue.hasOwnProperty(recipientId) && userIdToMessagesQueue[recipientId].length > 0)
    {
      userIdToLastSentTimestamp[recipientId] = Date.now();
      var messageData = userIdToMessagesQueue[recipientId].shift();
      callSendAPI(messageData);
    }
  }
}

/**
 * Sets the target mood for the given user.
 */
function setTargetMood(fbid, targetMood, onCompleteCallback)
{
  database.updateUserState(fbid,
                           {"targetmood" : targetMood},
                           {"targetmood" : targetMood, "targetlocation" : -1},
                           onCompleteCallback);
}

/**
 * Sets the target location for the given user.
 */
function setTargetLocation(fbid, targetLocation, onCompleteCallback)
{
  database.updateUserState(fbid,
                           {"targetlocation" : targetLocation},
                           {"targetmood" : -1, "targetlocation" : targetLocation},
                           onCompleteCallback);
}

/**
 * Performs the next action for the given user.
 */
function doNextAction(fbid, event)
{
  var onRetrieveComplete = function(obj)
  {
    if(obj['targetmood'] == null)
    {
      // Introduction - first time only
      sendTextMessage(fbid, "Hi there, I can help you select an ambient sound thats right for you.");
    }
    
    if(obj['targetmood'] == null || obj['targetmood'] == -1)
    {
      // Question 1
      sendTargetMoodSelectionStructuredMessage(fbid);
    }
    else if(obj['targetlocation'] == null || obj['targetlocation'] == -1)
    {
      // Question 2
      sendTargetLocationSelectionStructuredMessage(fbid);
    }
    else
    {
      // End
      sendTextMessage(fbid, "I'm sending you your ambient sounds now, please wait.");
      sendAudioLinkMessage(fbid, obj);
      sendTextMessage(fbid, "Here is your ambient sound effect. Let me know if you want to pick a new ambient effect.");
      database.resetUserData(fbid, function(){});
    }
  };
  
  database.retrieveUserState(fbid, onRetrieveComplete);
}

/*
 * Send mood selection message using the Send API.
 */
function sendTargetMoodSelectionStructuredMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Select the mood that you're trying to achieve right now",
          buttons:[
            {
              type: "postback",
              title: "Relaxation",
              payload: "mood-option-1"
            },
            {
              type: "postback",
              title: "Sleep",
              payload: "mood-option-2",
            },
            {
              type: "postback",
              title: "Concentration",
              payload: "mood-option-3",
            }
          ]
        }
      },
      metadata: "postback_message"
    }
  };

  addMessageToQueue(recipientId, messageData);
}

/*
 * Send location selection message using the Send API.
 */
function sendTargetLocationSelectionStructuredMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Does being around people relax you?",
          buttons: [
            {
              type: "postback",
              title: "No Way!",
              payload: "location-option-1"
            },
            {
              type: "postback",
              title: "Yes!",
              payload: "location-option-2",
            },
            {
              type: "postback",
              title: "Sometimes",
              payload: "location-option-3",
            }
          ]
        }
      }
    },
    metadata: "postback_message"
  };

  addMessageToQueue(recipientId, messageData);
}

/*
 * Send audio link using the Send API.
 */
function sendAudioLinkMessage(recipientId, data) {
  var choice1 = data["targetmood"] - 1;
  var choice2 = data["targetlocation"] - 1;
  var index = (choice1 * 3) + choice2;
  
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: SERVER_URL + "/" + SOUND_FILENAMES[index],
      metadata: "text_message"
    }
  };

  addMessageToQueue(recipientId, messageData);
}

/*
 * Send a text message using the Send API.
 */
function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText,
      metadata: "text_message"
    }
  };

  addMessageToQueue(recipientId, messageData);
}

// cache maps to queue messages for each user and prevent messages being
// recieved in incorrect order.
var userIdToMessagesQueue = {};
var userIdToLastSentTimestamp = {};
// 10 seconds timeout for recieving an echo from a message sent to a user
const timeoutInMilliseconds = 10000;

var SOUND_FILENAMES = ["forest_birds.mp3", "city_hum.mp3", "river.mp3",
                       "evening_rain_forest.mp3", "night_crickets.mp3", "night_forest_stream.mp3",
                       "ocean_waves.mp3", "cafe.mp3", "stormy_street.mp3"];

// Start server.
app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});

module.exports = app;