const IRC_regex = /(^@\S*? )?(:\S* )(\S* )((?:[^:]\S* ?)*)(:.*$)?/;
class Chat {
    states = {
        NEW: 'new',
        CONNECTING: 'connecting',
        CONNECTED: 'connected',
        JOINING: 'joining a channel',
        JOINED: 'in a channel',
        DISCONNECTING: 'disconnecting',
        DISCONNECTED: 'disconnected',
        ERROR: 'error'
    }

    constructor(channel = 'ExperimentalCyborg') {
        //available callbacks
        this.onCommand = () => { };     // called on every incoming IRC command, Receives a command object (raw ircv3 parameters, see the irc spec)
        this.onMessage = () => { };     // called on PRIVMSG matching the channel we're in, Receives a message object with attributes 'time', 'user', 'message', 'tags'.
        this.onClearmsg = () => { };    // called on CLEARMSG, receives the UUID of the message that should be removed (uuid is one of the tags in a message object)
        this.onClearchat = () => { };   // called on CLEARCHAT, receives the username whos messages need to be removed
        this.onError = () => { };       // called on error. Receives a human readable string with a reason.
        this.onStateChange = () => { }; // called on state change of this instance. Receives a human readable string from the states object.

        //private stuff
        this._ws = null;
        this._joinSuccess = false;
        this._intentionalDisconnect = false;

        this.channel = channel.toLowerCase();
        this.state = this.states.NEW;
    }

    _state = (s) => {
        this.state = s;
        this.onStateChange(s);
    }

    _open = event => {
        this._state(this.states.CONNECTED);
        this._ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
        this._ws.send('PASS TwitchCIT');
        this._ws.send(`NICK justinfan${Math.floor(Math.random() * 100000) + 1338}`);  // I'll leave 1337 and below to twitch devs
        this._ws.send(`JOIN #${this.channel}`);
        this._state(this.states.JOINING);
        window.setTimeout(
            () => {
                if (!this._joinSuccess) {
                    this._state(this.states.ERROR);
                    this.disconnect();
                    this.onError(`Failed to join channel "${this.channel}"`);
                }
            }
            , 6000)
    }

    _error = event => {
        this.onError('Encountered a websocket error');
    }

    _message_raw = event => {
        // sometimes the server sends multiple IRC messages in one websocket message.
        let messages = event.data.split('\r\n');
        messages.forEach(element => { this._message(element) });
    }

    _close = event => {
        if (this.state == this.states.ERROR) {
            // expected disconnect without state change
        } else if (this._intentionalDisconnect) {
            this._state(this.states.DISCONNECTED);
        } else {
            this._state(this.states.ERROR);
            this.onError('Connection lost');
        }
    }

    _message = (data) => {
        if (data.startsWith('PING ')) { //keepalive
            this._ws.send('PONG');
            return;
        }

        if (!data || (data.indexOf(':') != 0 && data.indexOf('@') != 0)) { //empty or invalid Twitch IRC message
            return;
        }

        //tokenize the IRC message
        let matches = data.match(IRC_regex);
        let message = {};
        let ircv3tags_raw = [];
        if (matches[1]) { ircv3tags_raw = matches[1].slice(1, -1).split(';'); }
        message.prefix = matches[2].slice(1, -1);
        message.command = matches[3].slice(0, -1);
        if (matches[4]) { message.params = matches[4].split(' '); }else{ message.params = []; }
        if (matches[5]) { message.tail = matches[5].substring(1); }

        //make a tags dictionary out of the raw tags list
        message.ircv3tags = {};
        ircv3tags_raw.forEach(element => {
            let keyvalue = element.split('=', 2);
            message.ircv3tags[keyvalue[0]] = keyvalue[1];
        })

        message.time = Date.now();
        this.onCommand(message);

        if (!message.params || message.params[0] != `#${this.channel}`) {
            return; // if the first param isn't the channel we joined, don't do anything else.
        }

        switch (message.command) {
            case 'JOIN':
                this._joinSuccess = true;
                this._state(this.states.JOINED);
                break;
            case 'CLEARMSG':
                this.onClearmsg(message.ircv3tags['target-msg-id']);
                break;
            case 'CLEARCHAT':
                this.onClearchat(message.tail);
                break;
            case 'PRIVMSG':
                this.onMessage({
                    'time': message.time,
                    'user': message.prefix.substring(message.prefix.indexOf('!') + 1, message.prefix.indexOf('@')),
                    'message': message.tail,
                    'tags': message.ircv3tags
                })
                break;
            default:
                //nah
        }
    }

    connect = () => {
        if (this._ws) {
            this._ws.onopen = () => { };
            this._ws.onerror = () => { };
            this._ws.onmessage = () => { };
            this._ws.onclose = () => { };
            this._ws.close();
            this._ws = null;
        }
        this._state(this.states.CONNECTING);
        this._ws = new WebSocket('wss://irc-ws.chat.twitch.tv');
        this._ws.onopen = this._open;
        this._ws.onerror = this._error;
        this._ws.onmessage = this._message_raw;
        this._ws.onclose = this._close;
    }

    disconnect = () => {
        if (this._ws.readyState < 2) {
            if (this.state != this.states.ERROR) {
                this._state(this.states.DISCONNECTING);
            }
            this._intentionalDisconnect = true;
            this._ws.close();
        }
    }
}
