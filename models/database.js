const config = require('config');
const pg = require('pg');

const DATABASE_URL = (process.env.DATABASE_URL) ? process.env.DATABASE_URL : config.get('databaseURL');

/**
 * Creates a users table.
 */
function createUsersTable()
{
    var client = new pg.Client(DATABASE_URL + '?ssl=true');
    client.connect();
    
    var queryString = 'CREATE TABLE users(fbid VARCHAR(128) PRIMARY KEY, targetmood INTEGER, targetlocation INTEGER);';
    
    var query = client.query(queryString);
    query.on('end', function() { client.end(); });
}

/**
 * Updates the user's state with the given facabook id.
 * @param {string} fbid - The user's facebook id.
 * @param {object} dataForUpdate - object defining properties to be updated with associated values if user data already exists.
 * @param {object} dataForInsert - object defining properties to be inserted with associated values if user data doesnt exist.
 * @param {updateUserStateCallback} callback - The request callback function.
 */
function updateUserState(fbid, dataForUpdate, dataForInsert, callback)
{
    var client = new pg.Client(DATABASE_URL + '?ssl=true');
    client.connect();
    
    var queryString = 'SELECT 1 FROM users WHERE fbid=$1 LIMIT 1'
    
    var query1 = client.query(queryString, [fbid], function(err, result)
    {
        if (err)
        {
            console.error('Error inserting query', err);
            throw err;
        }
        
        // Depending on whether data already exists or not for the user, we build
        // a query based on the given key value pairs in the data objects.
        var queryString;
        var valuesArray = [fbid];
        var dataAlreadyExists = result.rows.length > 0;
        if(dataAlreadyExists)
        {
            // Update an existing user's data.
            queryString = 'UPDATE users SET';
            var n = 2; // n=2 since fbid is parameter $1
            for(var key in dataForUpdate)
            {
                if(n > 2)
                {
                    queryString += ',';
                }
                queryString += ' ' + key + '=$' + n;
                valuesArray.push(dataForUpdate[key]);
                n++;
            }
            
            queryString += ' WHERE fbid=$1;'
        }
        else
        {
            // Insert a new user's data.
            queryString = 'INSERT INTO users VALUES ($1';
            var n = 2; // n=2 since fbid is parameter $1
            for(var key in dataForInsert)
            {
                queryString += ', $' + n;
                valuesArray.push(dataForInsert[key]);
                n++;
            }
            
            queryString += ');';
        }
        
        var query2 = client.query(queryString, valuesArray, function(err, result)
        {
            if (err)
            {
                console.error('Error inserting query', err);
                throw err;
            }
            
            callback();
        });
        
        query2.on('row', function(row) {console.log(row);});
        query2.on('end', function() {client.end();});
    });
}

/**
 * Returns the state for the current user
 * @param {string} fbid - The user's facebook id
 * @param {retrieveUserStateCallback} callback - The request callback function.
 */
function retrieveUserState(fbid, callback)
{
    var client = new pg.Client(DATABASE_URL + '?ssl=true');
    client.connect();
    
    var queryString = 'SELECT * FROM users WHERE fbid=$1'
    
    var query = client.query(queryString, [fbid], function(err, result)
    {
        if (err)
        {
            console.error('Error inserting query', err);
            throw err;
        }
        
        if(result.rows.length != 0)
        {
            callback(result.rows[0]);
        }
        else
        {
            callback({});
        }
    });
    
    query.on('row', function(row) {console.log(row);});
    query.on('end', function() {client.end();});
}

/**
 * Resets the data for a user with the given fbid.
 * @param {string} fbid - The user's facebook id
 * @param {resetUserDataCallback} onCompleteCallback - The request callback function.
 */
function resetUserData(fbid, onCompleteCallback)
{
    updateUserState(fbid, {"targetmood":-1, "targetlocation":-1}, {"targetmood":-1, "targetlocation":-1}, onCompleteCallback);
}

module.exports.updateUserState = updateUserState;
module.exports.retrieveUserState = retrieveUserState;
module.exports.resetUserData = resetUserData;