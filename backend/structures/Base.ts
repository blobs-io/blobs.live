// Import packages
import * as express from "express";
import * as ws from "ws";
import * as http from "http";
import {readFileSync} from "fs";
import bodyParser = require("body-parser");
// Import structures
const LoadbalancerConfig = require("../../configs/lb");
const DatabaseConfig = require("../../configs/database");
import Database from "./Database";
import Loadbalancer from "./Loadbalancer";
import * as SessionIDManager from "./SessionIDManager";
import WS, * as WSEvents from "../WSEvents";
import {EventTypes, OPCODE} from "../WSEvents";
import * as Room from "./Room";
import Maps from "./Maps";
import * as Socket from "./Socket";
import {wsSocket} from "./Socket";
import APIController from "../api/APIController";
import ClanController from "../clans/ClanController";
import RouteController from "../routes/RouteController";
import Captcha from "./Captcha";
import Player from "./Player";
import EliminationRoom, {State} from "./EliminationRoom";
import cookieParser = require("cookie-parser");

// Represents an http server that is used
export interface Server {
    // The express router
    app: express.Application;
    // Actual HTTP server (may be undefined)
    _server?: any;
    // Port that the webserver is listening to
    port: number;
    // A callback function that is being called when the server is ready to accept requests
    readyCallback?: () => any;
}

// Represents options that may be used when instantiating Base
interface BaseOptions {
    useLoadbalancer?: boolean;
}

// Represents a Maintenance
interface Maintenance {
    // Whether this maintenance is enabled or not
    enabled: boolean;
    // The reason for this maintenance
    reason?: string;
}

// Used for sharing required data across all modules
export default class Base {
    // The server
    public server?: Server;
    // The WebSocket server
    public wsServer?: ws.Server;
    // The database driver
    public db?: Database;
    // A 45-characters long token that is used to access the database
    // WARNING: Do not give this to anyone
    // It will be logged to the console when the database is ready to execute queries
    public dbToken: string;
    // A path to the database
    public dbPath: string | undefined;
    // A maintenance
    public maintenance: Maintenance = {
        enabled: false
    };
    // The HTTP Server for the express router
    public _server?: http.Server;
    // The WebSocket handler (for handling websocket messages)
    public WSHandler: WS;
    // All existing rooms
    public rooms: Room.default[];
    // A map-store
    public maps: Maps;
    // An array that includes all connected sockets
    public sockets: Socket.default[];
    // The API Controller (handles API requests)
    public APIController?: APIController;
    // The Clan Controller (handles clan requests)
    public ClanController?: ClanController;
    // All requested captchas
    public captchas: Captcha[];
    // The Route Controller (handles all incoming requests)
    public RouteController?: RouteController;
    // All websocket connections (game)
    public wsSockets: Socket.wsSocket[];
    // The loadbalancer
    public loadbalancer?: Loadbalancer;

    constructor(options?: BaseOptions) {
        // Assign all local variables
        if (options && options.useLoadbalancer) {
            this.loadbalancer = new Loadbalancer(LoadbalancerConfig.token, LoadbalancerConfig.host);
            this.loadbalancer.connect();
        }
        this.wsSockets = [];
        this.sockets = [];
        this.WSHandler = new WS(this);
        this.maps = new Maps();
        this.captchas = [];
        this.rooms = [];

        // FFA
        for (let i: number = 0; i < 3; ++i) {
            const room: Room.default = new Room.default(this, this.maps.mapStore.find((v: any) => v.map.name === "default"), "ffa" + (i + 1));
            room.addItems(5);
            this.rooms.push(room);
        }
        // Elimination
        for (let i: number = 0; i < 3; ++i) {
            this.rooms.push(
                new EliminationRoom(this, this.maps.mapStore.find((v: any) => v.map.name === "default"), "elim" + (i + 1))
            );
        }

        // Generates a "session ID", which is used to access the database
        this.dbToken = SessionIDManager.generateSessionID(24);
    }

    /**
     * Initializes the webserver & websocket server
     * 
     * @param server The server
     */
    public initializeServer(server: Server): void {
        this.server = server;
        this._server = server.app.listen(server.port);
        this.wsServer = new ws.Server({
            server: this._server
        });

        this.server.app.use(cookieParser());
    }

    /**
     * Initializes all controllers
     */
    public initializeControllers(): void {
        if (!this.server) return;
        this.APIController = new APIController(this.server.app, this);
        this.APIController.listen();

        this.ClanController = new ClanController(this.server.app, this.db);
        this.ClanController.listen();

        this.RouteController = new RouteController(this.server.app, this);
        this.RouteController.listen();
    }

    /**
     * Initializes database
     */
    public initializeDatabase(): void {
        this.db = new Database(DatabaseConfig);
    }

    /**
     * Initializes routes
     *
     * @returns {Promise<void>}
     */
    public async initializeRoutes(): Promise<void> {
        if (!this.server) return;
        const { app } = this.server;
        // For accessing POST body
        app.use(bodyParser.urlencoded({ extended: true }));
        app.use(bodyParser.json());

        // Assets / JS / CSS
        app.use("/assets", express.static("./public/assets"));
        app.use("/js", express.static("./public/js"));
        app.use("/css", express.static("./public/css"));
    }

    /**
     * Initializes all events
     */
    public async initializeEvents(): Promise<void> {
        if (!this.wsServer) return;
        // Maintenance check
        if (this.maintenance.enabled) throw new Error(this.maintenance.reason || "Maintenance");

        // Handle incoming WebSocket connections
        this.wsServer.on("connection", (conn: ws) => {
            // Generate unique ID
            let socketID: string = SessionIDManager.generateSessionID(16);
            while(this.wsSockets.some((v: any) => v.id === socketID))
                socketID = SessionIDManager.generateSessionID(16);

            // Push to wsSockets array
            this.wsSockets.push({
                conn, id: socketID
            });

            // Let WSHandler handle incoming WebSocket messages
            conn.on("message", (data: any) => this.WSHandler.exec(conn, socketID, data));
        });

        // Check for heartbeats and other timing-based actions
        setInterval(() => {
            for (let roomIndex: number = 0; roomIndex < this.rooms.length; ++roomIndex) {
                const room: Room.default | undefined = this.rooms[roomIndex];
                if (!room) return;

                room.broadcast((ws: wsSocket, player?: Player) => {
                    if (!player) return;
                    if (Date.now() - player.lastHeartbeat > WSEvents.default.intervalLimit) {
                        // User has not sent heartbeats for a number of milliseconds (see WSEvents.default.intervalLimit)
                        ws.conn.send(JSON.stringify({
                            op: WSEvents.OPCODE.CLOSE,
                            d: {
                                message: "Missing heartbeats"
                            }
                        }));
                        WSEvents.default.disconnectSocket(ws, room);
                        if (room instanceof EliminationRoom && room.state === State.COUNTDOWN && room.players.length === EliminationRoom.minPlayersStartup - 1) {
                            room.state = State.WAITING;
                            room.countdownStarted = 0;
                            room.broadcastSend(JSON.stringify({
                                op: OPCODE.EVENT,
                                t: EventTypes.STATECHANGE,
                                d: {
                                    state: room.state,
                                    countdownStarted: null
                                }
                            }));
                        }
                    }

                    // Generates everyones health points every Y milliseconds
                    player.regenerate(true);

                    // Transmit coordinates to all connected WebSockets if there are at least 2 players in this room
                    // Sending coordinates to rooms with only one player is unnecessary because the client doesn't need its own coordinates
                    if (room.players.length >= 2) {
                        ws.conn.send(JSON.stringify({
                            op: WSEvents.OPCODE.EVENT,
                            t: WSEvents.EventTypes.COORDINATECHANGE,
                            d: {
                                players: room.players
                            }
                        }));
                    }
                });
            }
        }, 20);
    }

    /**
     * Initializes all controllers and components
     */
    public async run(server?: Server): Promise<Base> {
        await this.initializeServer(server || {
            app: express.default(),
            port: Number(process.env.PORT) || 80
        });
        await this.initializeDatabase();
        await this.initializeRoutes();

        if (!this.server) return this;
        this.server.app.use((_: express.Request, res: express.Response, next: () => void) => {
            if (this.maintenance.enabled) {
                res.send(
                    readFileSync("./backend/Maintenance.html", "utf8")
                        .replace(/{comment}/g, this.maintenance.reason || "")
                );
                return;
            }
            return next();
        });

        await this.initializeEvents();
        await this.initializeControllers();
        return this;
    }
}