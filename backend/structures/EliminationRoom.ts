import * as Room from "./Room";
import {wsSocket} from "./Socket";
import {EventTypes, OPCODE} from "../WSEvents";
import Base from "./Base";

export enum State {
    WAITING,
    INGAME
}

export default class EliminationRoom extends Room.default {
    static waitingTime: number = 300000;
    static waitingTimeFull: number = 120000;
    static minPlayersStartup: number = 4;
    public state: State;
    public _interval: NodeJS.Timeout;

    constructor(base: Base, map: any = {}, id: string = Math.random().toString(32).substr(2,6), state = State.WAITING) {
        super(base, map, id, Room.Mode.ELIMINATION);
        this.state = state;
        this._interval = setInterval(() => {
            if (this.state === State.WAITING && Date.now() >= this.startsAt) {
                this.start();
                clearInterval(this._interval);
            }
        }, 1000);
    }

    get startsAt() {
        return this.createdAt + (this.players.length >= EliminationRoom.minPlayersStartup ?
            EliminationRoom.waitingTimeFull :
            EliminationRoom.waitingTime);
    }

    start() {

    }
}