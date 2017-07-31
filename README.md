# botbuilder-wit-remade

A fork from [botbuilder-wit](https://github.com/sebsylvester/botbuilder-wit).

Node.js module that provides [Wit.ai](https://wit.ai) NLP integration for the [Microsoft Bot Builder SDK](https://dev.botframework.com/), with built-in support for caching with Redis and Memcached.

## Installation

`npm install --save botbuilder-wit-remade`

## Bot setup
```
const restify = require('restify');
const builder = require('botbuilder');
const { WitRecognizer } = require('botbuilder-wit-remade');

// Initialize the Restify server
const server = restify.createServer();

server.listen(process.env.port || process.env.PORT || 3978, () => {
    console.log('%s listening to %s', server.name, server.url)
});

// Initialize the ChatBot
const connector = new builder.ChatConnector({
    appId: 'YOUR_APP_ID',
    appPassword: 'YOUR_APP_PASSWORD',
});
server.post('/api/messages', connector.listen());

// Start the ChatBot
let bot = new builder.UniversalBot(connector);

// Start WIT.AI Recognizer
let recognizer = new WitRecognizer('WIT.AI SECRET KEY');
bot.recognizer(recognizer);
```

## General usage
```
bot.dialog('/doSomething', session => {...}).triggerAction({ 
    matches: 'intent.name'
});
```

## Enable Response Caching
If caching is enabled, the WitRecognizer will try to serve the cached result first,
and only send a request to Wit.ai when necessary. 
The subsequent response from Wit.ai will be cached for the configured duration.
```
// An example
// ----------
// Create a Redis client
const redis = require('redis');
const redisClient = redis.createClient({/* options */});

// Or a Memcached client
const Memcached = require('memcached');
const memcached = new Memcached('hostname:11211');

// Configure the recognizer to use the client
// Set an optional key expire duration in seconds, defaults to 3 hours
const recognizer = new WitRecognizer('Wit.ai_access_token', { cache: redisClient, expire: 3600 });
```

## Using Entities

You can use the utility class [EntityRecognizer](https://docs.botframework.com/en-us/node/builder/chat-reference/classes/_botbuilder_d_.entityrecognizer.html) to parse & resolve common entities.
```
// Inside your dialog handler that receives the session and arguments object
const { EntityRecognizer } = require('botbuilder');
const location = EntityRecognizer.findEntity(args.entities, 'location')
```

## Using the Wit.ai client
You can still use the Wit.ai client directly by accessing the ```witClient``` property of the instantiated WitRecognizer.
```
const recognizer = new WitRecognizer('Wit.ai_access_token');
const witClient = recognizer.witClient;
```

## License

MIT