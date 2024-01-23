const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const cookieParser = require('cookie-parser');
//const { MongoClient } = require('mongodb');
const MongoClient = require('mongodb').MongoClient;

app.use(cookieParser());

const channels = {};

app.get('/', (req, res) => {
    res.sendFile(`${__dirname}/public/login.html`);
});

app.get('/chat', (req, res) => {
    const username = req.query.username;
    console.log(username);

    res.cookie('username', username);

    if (!username) {
        return res.redirect('/');
    }
    res.sendFile(`${__dirname}/public/index.html`);
});

//const mongoUrl = 'mongodb://localhost:27017';
const dbName = 'chatApp';

async function getChannels() {
    const channelsCollection = db.collection('channels');
    const channels = await channelsCollection.find({}).toArray();
    return channels.map(channel => channel.name);
}

async function connectToMongoDB() {
    try {
        const uri = 'mongodb://max:votre_mot_de_passe@127.0.0.1:27017/';
        const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

        //const client = new MongoClient(mongoUrl, { useNewUrlParser: true, useUnifiedTopology: true });
        await client.connect();
        console.log('Connected to MongoDB');
        db = client.db(dbName); // Affecter db ici après la connexion réussie
        return client.db(dbName);
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
        throw error;
    }
}

connectToMongoDB()
    .then((db) => {
        io.on('connection', async(socket) => {
            console.log('Un utilisateur s\'est connecté');

            var username = decodeURIComponent(socket.handshake.headers.cookie.replace(/(?:(?:^|.*;\s*)username\s*\=\s*([^;]*).*$)|^.*$/, "$1"));

            const updatedChannels = await getChannels();
        // Émettre la liste mise à jour à tous les utilisateurs connectés
            io.emit('update channels', updatedChannels);

            socket.on('chat message', async (msg) => {
                const messagesCollection = db.collection('messages');
                const usermsg = username + ": " + msg;
                await messagesCollection.insertOne({ message: usermsg });
                io.emit('chat message', usermsg);
            });

            // ... Reste du code ...

            socket.on('disconnect', () => {
                // ... Utilisez la base de données ici si nécessaire ...
            });

            
        });

        server.listen(3000, () => {
            console.log('Listening on port 3000');
        });
    })
    .catch((error) => {
        console.error('Error in MongoDB connection:', error);
    });

    /*function getUsername(socketId) {
        const channelNames = Object.keys(channels);
        for (const channelName of channelNames) {
            const user = channels[channelName].find(user => user.id === socketId);
            if (user) {
                return user.username;
            }
        }
        return null;
    }

    // Fonction pour trouver l'ID du socket par nom d'utilisateur
    function findSocketIdByUsername(username) {
        const channelNames = Object.keys(channels);
        for (const channelName of channelNames) {
            const user = channels[channelName].find(user => user.username === username);
            if (user) {
                return user.id;
            }
        }
        return null;
    }*/

io.on('connection', (socket) => {
    console.log('Un utilisateur s\'est connecté');

    var username = decodeURIComponent(socket.handshake.headers.cookie.replace(/(?:(?:^|.*;\s*)username\s*\=\s*([^;]*).*$)|^.*$/, "$1"));
    
    socket.emit('update channels', getChannels());
    

    socket.on('chat message', (msg) => {
        var username = decodeURIComponent(socket.handshake.headers.cookie.replace(/(?:(?:^|.*;\s*)username\s*\=\s*([^;]*).*$)|^.*$/, "$1"));
        var usermsg = username + ": " + msg ;
        //saveMessageToDB(usermsg);
        io.emit('chat message', usermsg);
    });

    socket.on('create channel', async (channelName) => {
        // Insérer le nouveau canal dans la base de données
        const channelsCollection = db.collection('channels');
        await channelsCollection.insertOne({ name: channelName });
        
        // Récupérer la liste mise à jour des canaux
        const updatedChannels = await getChannels();
        // Émettre la liste mise à jour à tous les utilisateurs connectés
        io.emit('update channels', updatedChannels);
    });

    socket.on('delete channel', async(channelNameToDelete) => {
        const channelsCollection = db.collection('channels');
        await channelsCollection.deleteOne({ name: channelNameToDelete });
        delete channels[channelNameToDelete];
        const updatedChannels = await getChannels();
        io.emit('update channels', updatedChannels);
    });

    socket.on('rename channel', async({ currentChannelName, newChannelName }) => {
        channels[newChannelName] = channels[currentChannelName];
        delete channels[currentChannelName];
        const channelsCollection = db.collection('channels');
        await channelsCollection.updateOne({ name: currentChannelName }, { $set: { name: newChannelName } });
        // Récupérer la liste mise à jour des canaux
        const updatedChannels = await getChannels();
        
        // Émettre la liste mise à jour à tous les utilisateurs connectés
        io.emit('update channels', updatedChannels);
        //io.emit('update channels', Object.keys(channels));
    });

    socket.on('join channel', (channelName) => {
        // Vérifier si le canal existe, sinon initialiser le tableau
        if (!channels[channelName]) {
            channels[channelName] = [];
        }
    
        socket.join(channelName);
        channels[channelName].push({ id: socket.id, username: username });
        io.to(channelName).emit('update users', getConnectedUsers(channelName));
        const message = `${username} has joined the channel ${channelName}`;
        io.to(channelName).emit('user joined', message);
        
    });

    socket.on('quit channel', (channelNameToQuit) => {
        if (channels[channelNameToQuit]) {
            const index = channels[channelNameToQuit].findIndex(user => user.id === socket.id);
            if (index !== -1) {
                const username = channels[channelNameToQuit][index].username;
                channels[channelNameToQuit].splice(index, 1);
                io.to(channelNameToQuit).emit('update users', getConnectedUsers(channelNameToQuit));
                const message = `${username} has quit the channel ${channelNameToQuit}`;
                io.to(channelNameToQuit).emit('user left', message);
                socket.leave(channelNameToQuit);
            }
        }
    });

    socket.on('disconnect', () => {
        Object.keys(channels).forEach((channel) => {
            const index = channels[channel].findIndex(user => user.id === socket.id);
            if (index !== -1) {
                const username = channels[channel][index].username;
                channels[channel].splice(index, 1);
                io.to(channel).emit('update users', getConnectedUsers(channel));
                const message = `${username} has left the channel ${channel}`;
                io.to(channel).emit('user left', message);
            }
        });
    });

    socket.on('list users', (channelName) => {
        const users = getConnectedUsers(channelName);
        io.to(channelName).emit('update users', getConnectedUsers(channelName));
        socket.emit('update users', users);
    });

    socket.on('list channels', async() => {
        // Récupérer la liste mise à jour des canaux
        const updatedChannels = await getChannels();
        // Émettre la liste mise à jour à tous les utilisateurs connectés
        io.emit('update channels', updatedChannels);
    });


    socket.on('change nickname', (newNickname) => {
        // Récupérez l'ID du socket
        const socketId = socket.id;
        // Recherchez le canal dans lequel se trouve l'utilisateur (s'il est dans un canal)
        let channelWithUser;
        Object.keys(channels).some((channel) => {
            const index = channels[channel].findIndex(user => user.id === socketId);
            if (index !== -1) {
                channelWithUser = channel;
                return true; // Arrêtez de chercher une fois trouvé
            }
            return false;
        });
    
        // Mettez à jour le nom d'utilisateur pour le socket spécifié
        if (channelWithUser && channels[channelWithUser]) {
            const index = channels[channelWithUser].findIndex(user => user.id === socketId);
            if (index !== -1) {
                channels[channelWithUser][index].username = newNickname;
                io.to(channelWithUser).emit('update users', getConnectedUsers(channelWithUser));
                const message = `User ${socketId} changed nickname to ${newNickname}`;
                io.to(channelWithUser).emit('nickname changed', message);
            }
        }

        
    });

    /*socket.on('private message', ({ recipient, message }) => {
        const sender = getUsername(socket.id);
        const recipientSocket = findSocketIdByUsername(recipient);

        if (recipientSocket) {
            io.to(recipientSocket).emit('private message', { sender, message });

            // Émettre également le message au sender pour qu'il puisse le voir
            socket.emit('private message', { sender, message });
        } else {
            // Émettre un message au sender s'il y a un problème avec le destinataire
            socket.emit('server message', 'User not found or offline.');
        }
    });
    socket.on('private message', function ({ sender, message }) {
        // Afficher le message privé dans la zone de messages
        $("#messages").append($("<p>").html(`<em>Whisper to ${sender}:</em> ${message}`));
        $("#messages").scrollTop($("#messages")[0].scrollHeight);
    });*/
    
    
    
});

function getConnectedUsers(channelName) {
    const users = [];

    if (channels[channelName]) {
        channels[channelName].forEach((user) => {
            users.push(user.username);
        });
    }

    return users;
}

server.listen(3000, () => {
    console.log('Listening on port 3000');
});
