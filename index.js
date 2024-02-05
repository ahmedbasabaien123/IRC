const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const cookieParser = require('cookie-parser');
const MongoClient = require('mongodb').MongoClient;

app.use(cookieParser());

const channels = {};

app.get('/', (req, res) => {
    res.sendFile(`${__dirname}/public/login.html`);
});

app.get('/chat', (req, res) => {
    const username = req.query.username;

    res.cookie('username', username);

    if (!username) {
        return res.redirect('/');
    }
    res.sendFile(`${__dirname}/public/index.html`);
});

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

io.on('connection', (socket) => {
    //console.log('Un utilisateur s\'est connecté');

    var username = decodeURIComponent(socket.handshake.headers.cookie.replace(/(?:(?:^|.*;\s*)username\s*\=\s*([^;]*).*$)|^.*$/, "$1"));
    
    socket.emit('update channels', getChannels());

    socket.on('private message', function ({ recipient, message, channelName }) {
        // Trouver le socket du destinataire
        const recipientSocket = getConnectedUserSocket(recipient, channelName);
    
        if (recipientSocket) {
            // Émettre le message privé au destinataire
            recipientSocket.emit('private message', message);
            // Émettre le message privé à l'expéditeur
            socket.emit('private message', message);
        } else {
            // Informer l'expéditeur que le destinataire n'est pas connecté
            console.log(`Recipient ${recipient} not found in channel ${channelName}`);
            socket.emit('private message', 'Recipient is not online');
        }
    });

    socket.on('chat message', (msg) => {
        var username = decodeURIComponent(socket.handshake.headers.cookie.replace(/(?:(?:^|.*;\s*)username\s*\=\s*([^;]*).*$)|^.*$/, "$1"));
        var usermsg = username + ": " + msg ;
        //saveMessageToDB(usermsg);
        //io.emit('chat message', usermsg);
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
        socket.emit('update users', users); // Utilisez socket.emit ici pour envoyer uniquement au socket actuel
    
    });

    socket.on('update users', function (users) {
                // Afficher la liste des utilisateurs dans la zone de message
                $("#messages").append($("<p>").html(`<strong>Users:</strong> ${users.join(', ')}`));
                $("#messages").scrollTop($("#messages")[0].scrollHeight);
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

        const decodedNickname = decodeURIComponent(newNickname);
    
        // Mettez à jour le nom d'utilisateur pour le socket spécifié
        if (channelWithUser && channels[channelWithUser]) {
            const index = channels[channelWithUser].findIndex(user => user.id === socketId);
            if (index !== -1) {
                channels[channelWithUser][index].username = decodedNickname;
                io.to(channelWithUser).emit('update users', getConnectedUsers(channelWithUser));
                const message = `User ${socketId} changed nickname to ${decodedNickname}`;
                io.to(channelWithUser).emit('nickname changed', message);
            }
        }  
    });
});

function getConnectedUsers(channelName) {
    const users = [];

    if (channels[channelName]) {
        channels[channelName].forEach((newNickname) => {
            users.push(newNickname.username);
            console.log("cc" +newNickname.username);
        });
    }
    return users;
}

function getConnectedUserSocket(username, channelName) {
    // Trouver le socket du destinataire dans le canal spécifié
    const channelUsers = channels[channelName];

    if (channelUsers) {
        const user = channelUsers.find(user => user.username === username);
        
        if (user) {
            const recipientSocketId = user.id;
            const recipientSocket = io.sockets.sockets.get(recipientSocketId);

            return recipientSocket;
        }
    }
    return null;
}

server.listen(3000, () => {
    console.log('Listening on port 3000');
});


