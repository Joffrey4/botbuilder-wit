import { Wit, WitContext } from 'node-wit';
import * as crypto from 'crypto';
import CacheAdapter from './adapters/CacheAdapter';
import RedisAdapter from './adapters/RedisAdapter';
import MemcachedAdapter from './adapters/MemcachedAdapter';

// Type of the object that represents an intent that is part of WitRecognizer's result
export interface IIntent {
    intent: string;
    score: number;
}

// Type of the object(s) that represents an entity that is part of WitRecognizer's result
export interface IEntity {
    entity: string;
    // The rawEntity property is included because Wit.ai doesn't have a perfectly consistent JSON response object.
    // In most cases there is a "value" property whose string value is then assigned to entity.
    // However, in case the value property is undefined, entity will be null.
    // In that case, it's necessary to be able to access the original entity via the "rawEntity" property.
    rawEntity: Object;
    type: string;
    startIndex?: number;
    endIndex?: number;
    score?: number;
}

// Type of the first argument of the recognize method. Contains the message text.
export interface IRecognizeContext {
    message: { text: string };
}

// Type of the second argument of the recognize method. Contains the processed result.
export interface IIntentRecognizerResult {
    score: number;
    intent: string;
    intents?: IIntent[];
    entities?: IEntity[];
}

// NOTE: there is an important difference between IEntity and IWitEntity.
// IEntity is the type of entity the Bot Builder SDK expects to receive from the recognize method.
// Entities of type IWitEntity are contained in the JSON response received from Wit.ai.
interface IWitEntity {
    type?: string;
    confidence: number;
    value?: string;
    values?: Object[];
}

// Type of the object that represents the JSON response from Wit.ai.
interface IWitResults {
    msg_id?: string;
    _text?: string;
    entities?: {
        [index: string]: IWitEntity[];
    };
    error?: string;
}

export interface IOptions {
    cache?: any;
    expire?: number
}

export enum CacheClients {
    Unknown, // 0
    Redis,
    Memcached,
}

/**
 * The WitRecognizer class that is used in conjunction with an IntentDialog.
 * @class
 * Example:
 * const recognizer = new WitRecognizer('Wit.ai_access_token');
 * const dialog = new IntentDialog({recognizers: [recognizer]});
 */
export class WitRecognizer {
    public witClient: Wit;
    public cacheAdapter: CacheAdapter = null;

    /**
     * Creates an instance of WitRecognizer.
     * @param accessToken {string} API token from Wit.ai
     * @param cache {any} Redis or Memcached client
     */
    constructor(accessToken: string, options: IOptions = {}) {
        const { cache } = options;

        if (!accessToken || typeof accessToken !== 'string') {
            throw new Error('Invalid argument. Constructor must be invoked with an accessToken of type "string".');
        }
        this.witClient = new Wit({ accessToken });

        // Evaluate the type of the cache client
        // Instantiate a corresponding adapter
        if (cache) {
            // By default, key's will expire after 3 hours
            const expire = typeof options.expire === 'number' ? options.expire : 3 * 3600;
            const clientType = this.getClientType(cache);

            if (clientType !== CacheClients.Unknown) {
                const _message = this.witClient.message;
                // Override the original message function with a new implementation
                // that checks the cache first before sending a request to Wit.ai.
                // The response from Wit.ai is then stored in the cache.
                this.witClient.message = this.witDecorator(_message);
            }

            // Instantiate the client's corresponding adapter
            switch (clientType) {
                case CacheClients.Redis:
                    this.cacheAdapter = new RedisAdapter(cache, expire);
                    break;
                case CacheClients.Memcached:
                    this.cacheAdapter = new MemcachedAdapter(cache, expire);
                    break;
                default: // CacheClients.Unknown
                    throw new Error("Invalid cache client. View the module's README.md for more details => https://github.com/sebsylvester/botbuilder-wit/blob/master/README.md");
            }
        }
    }

    /**
     * Makes a request to Wit.ai and parses the response in a way the Bot Builder SDK understands.
     * @param {IRecognizeContext} context - contains the message received from the user
     * @param {function} done - the result callback
     */
    recognize(context: IRecognizeContext, done: (err: Error, result: IIntentRecognizerResult) => void) {
        let result = <IIntentRecognizerResult>{ score: 0.0, intent: null };
        if (context && context.message && context.message.text) {
            const utterance = context.message.text;

            // Send a request to Wit.ai
            this.witClient.message(utterance, <WitContext>{})
                .then((response: IWitResults) => {
                    // Check if Wit.ai responded with an error
                    if (response.error) {
                        return done(new Error(response.error), null);
                    }

                    // Wit.ai currently does not support multiple intents.
                    // The intent property is either undefined or an array with a single object.
                    // Also note that, unlike LUIS.ai, Wit.ai treats an intent like a regular entity
                    let entities = response.entities;
                    let entities_keys = Object.keys(entities);
                    const hasOneIntent = entities_keys.length >= 1;

                    // If there no useful response from Wit.ai, trigger the IntentDialog's default handler
                    if (!hasOneIntent) {
                        return done(null, result);
                    } else {
                        const intent = entities[entities_keys[0]][0];
                        // Update the default values for intent (null) and score (0.0)
                        result.intent = entities_keys[0] + "." + intent["value"];
                        result.score = intent["confidence"];
                        result.intents = [{ intent: result.intent, score: result.score }];
                        return done(null, result);
                    }
                })
                .catch((err: Error) => {
                    done(err, null);
                });
        } else {
            done(null, result);
        }
    }

    /**
     * Determines the type of the provided cache client.
     * @param {*} client - the client with which the results will be saved to the cache.
     * @returns {CacheClients} any of the possible enum values
     */
    getClientType(client: any): CacheClients {
        let clientType = CacheClients.Unknown;

        if (typeof client === 'object' && client.constructor) {
            switch (client.constructor.name) {
                case 'RedisClient':
                    clientType = CacheClients.Redis;
                    break;
                case 'Client':
                    clientType = CacheClients.Memcached;
            }
        }

        return clientType;
    }

    /**
     * The decorator function that adds caching to the Wit.ai request/response cycle.
     * @param {function} message - the original Wit.message function that will be decorated
     * @returns {function} the decorated function
     */
    witDecorator(message: Function): (utterance: string) => any {
        return (utterance) => {
            // Create hash from the utterance.
            const hash = crypto.createHash('sha256');
            hash.update(utterance);
            const key = hash.digest('hex');

            return new Promise((resolve, reject) => {
                // Check if the key exists
                this.cacheAdapter.get(key, (error, result) => {
                    if (error) {
                        console.error(error);
                        // If something failed while accessing the cache,
                        // it's still possible to continue and access Wit.ai,
                        // so there is no need to invoke reject(error)
                        return resolve(null);
                    }

                    try {
                        resolve(result ? JSON.parse(result) : null);
                    } catch (error) {
                        resolve(null);
                    }
                });
            }).then(result => {
                if (result) {
                    // Reset expire to initial value
                    this.cacheAdapter.touch(key, (error, result) => {
                        if (error) console.error(error);
                    });
                    // Return the result, skip Wit.ai
                    return Promise.resolve(result);
                } else {
                    // No cached result was found, use Wit.ai to parse the utterance
                    const witPromise = message(utterance);
                    witPromise.then((result: IWitResults) => {
                        // Cache the result from Wit.ai unless it contains an error message
                        // Possible error would be: "Bad auth, check token/params"
                        if (!result.error) {
                            const value = JSON.stringify(result);
                            this.cacheAdapter.set(key, value, (error, result) => {
                                if (error) console.error(error);
                            });
                        }
                    }).catch((error: Error) => {
                        console.error(error)
                    });

                    return witPromise;
                }
            });
        };
    }
}