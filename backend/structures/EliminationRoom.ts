import * as Room from "./Room";
import Socket, {wsSocket} from "./Socket";
import {EventTypes, OPCODE} from "../WSEvents";
import Base from "./Base";
import Player from "./Player";

export enum State {
    WAITING,
    COUNTDOWN,
    INGAME
}

export default class EliminationRoom extends Room.default {
    static waitingTime: number = 120000;
    static minPlayersStartup: number = 2;
    public countdownStarted: number = null;
    public state: State;
    public _interval: NodeJS.Timeout;

    constructor(base: Base, map: any = {}, id: string = Math.random().toString(32).substr(2,6), state = State.WAITING) {
        super(base, map, id, Room.Mode.ELIMINATION);
        this.state = state;
        this._interval = setInterval(() => {
            if (this.state === State.COUNTDOWN && Date.now() >= this.startsAt) {
                this.start();
                clearInterval(this._interval);
            }
        }, 1000);
    }

    get startsAt() {
        if (this.state === State.WAITING) return null;
        else return this.countdownStarted + EliminationRoom.waitingTime;
    }

    start(): void {
        this.state = State.INGAME;
        this.broadcastSend(JSON.stringify({
            op: OPCODE.EVENT,
            t: EventTypes.STATECHANGE,
            d: {
                state: this.state
            }
        }));
    }

    isSingle(): boolean {
        return this.players.length === 1;
    }

    handleEnd(): void {
        if (this.isSingle() && this.state === State.INGAME) {
            const winner: Player = this.players[0];
            const socket: wsSocket = this.base.wsSockets.find(v => v.id === winner.id);

            if (!winner.guest) {
                // TODO: don't hardcode values
                // 1st +250 for now
                this.base.db.run("UPDATE accounts SET br = br + 250 WHERE username = ?", winner.owner);
            }

            if (socket) {
                socket.conn.send(JSON.stringify({
                    op: OPCODE.EVENT,
                    t: EventTypes.PLAYER_KICK,
                    d: {
                        message: `Room has ended.\nWinner: ${winner.owner}`
                    }
                }));
                socket.conn.close();
                this.base.rooms.splice(this.base.rooms.findIndex(v => v.id === this.id), 1);
            }
        }
    }
}