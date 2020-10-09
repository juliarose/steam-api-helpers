'use strict';

const https = require('https');

/**
 * @typedef {object} RequestOptions
 * @property {string} uri - The uri to fetch.
 * @property {string} [method] - The request method.
 * @property {object} [qs] - An object containing values to pass as a querystring.
 */

/**
 * Gets a request
 * @param {RequestOptions} opts - Options.
 * @returns {Promise.<object>} Resolves with response.
 */
async function getRequest(opts) {
    // create a clone so we do not modify the original object
    const options = Object.assign({}, opts);
    // split url
    const { hostname, pathname } = new URL(options.uri || options.url);
    
    options.hostname = hostname;
    options.path = pathname;
    
    if (options.method === undefined) {
        options.method = 'GET';
    }
    
    delete options.uri;
    delete options.url;

    if (typeof options.qs === 'object') {
        // get url params as a list
        const params = Object.entries(options.qs).map(([key, value]) => {
            return [
                key,
                value
            ].map(encodeURIComponent).join('=');
        });
        // tie params together
        const qs = params.join('&');
        
        if (qs.length > 0) {
            // add the query string to the end of the URL
            options.path = (options.path || '/') + '?' + qs;
        }
        
        // delete it from the options
        delete options.qs;
    }
    
    return new Promise((resolve, reject) => {
        https.get(options, (response) => {
            let body = '';
            
            response.on('data', (chunk) => {
                // add data to body
                body += chunk;
            });
            
            response.on('end', () => {
                // resolve with response and body
                resolve({
                    response,
                    body
                });
            });
        }).on('error', reject);
    });
}

/**
 * Gets a request
 * @param {RequestOptions} opts - Options.
 * @returns {Promise.<object>} Resolves with response JSON.
 */
async function getJSON(opts) {
    const result = await getRequest(opts);
    const { response, body } = result;
    const { headers, statusCode, statusMessage } = response;
    const responseContentType = headers['content-type'];
    // we are looking for a JSON response
    const isJSON = Boolean(
        /^application\/json/.test(responseContentType)
    );
    
    if (!isJSON) {
        // not what we expected
        return Promise.reject(new Error(
            statusMessage ||
            statusCode ||
            body
        ));
    }
    
    try {
        return JSON.parse(body);
    } catch (e) {
        // invalid JSON
        return Promise.reject(e);
    }
}

module.exports = {
    getJSON
};
