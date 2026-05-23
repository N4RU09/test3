import Peer, { DataConnection } from 'peerjs';
import { NetworkMessage } from './types';

// Let's create a readable room prefix to avoid collisions with other apps using the public PeerJS server
export const ROOM_PREFIX = 'jumpup-room-';

export class MultiplayerNetwork {
  public peer: Peer | null = null;
  public connections: Record<string, DataConnection> = {};
  public isHost: boolean = false;
  public roomCode: string = '';
  public peerId: string = '';
  
  // Callbacks
  public onConnectionOpen?: () => void;
  public onConnectionClose?: () => void;
  public onError?: (error: string) => void;
  public onData?: (senderPeerId: string, data: NetworkMessage) => void;
  public onPlayerJoined?: (peerId: string) => void;
  public onPlayerLeft?: (peerId: string) => void;

  constructor() {}

  /**
   * Initializes host mode by creating a peer with a readable 4-digit numeric room code
   */
  public async initializeHost(roomCode: string): Promise<string> {
    this.isHost = true;
    this.roomCode = roomCode;
    const targetPeerId = `${ROOM_PREFIX}${roomCode}`;

    return new Promise((resolve, reject) => {
      // Connect to the public PeerJS cloud server
      const newPeer = new Peer(targetPeerId, {
        debug: 1, // Minimize console noise
      });

      newPeer.on('open', (id) => {
        this.peer = newPeer;
        this.peerId = id;
        this.setupHostListeners();
        resolve(id);
      });

      newPeer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          reject(new Error('Room code already in use. Please try another code.'));
        } else {
          reject(err);
        }
        this.cleanup();
      });
    });
  }

  /**
   * Initializes client mode with a specific room code
   */
  public async initializeClient(roomCode: string, selfName: string): Promise<string> {
    this.isHost = false;
    this.roomCode = roomCode;
    
    // Generate a random client peer ID or let PeerJS generate one
    return new Promise((resolve, reject) => {
      const newPeer = new Peer({
        debug: 1,
      });

      newPeer.on('open', (id) => {
        this.peer = newPeer;
        this.peerId = id;
        this.setupClientListeners();
        
        // At this point, the client peer is open. Next, we connect to the host
        this.connectToHost(roomCode)
          .then(() => resolve(id))
          .catch((err) => {
            reject(err);
            this.cleanup();
          });
      });

      newPeer.on('error', (err) => {
        reject(err);
        this.cleanup();
      });
    });
  }

  /**
   * Handles connecting to the host
   */
  private async connectToHost(roomCode: string): Promise<void> {
    const hostPeerId = `${ROOM_PREFIX}${roomCode}`;
    if (!this.peer) return Promise.reject(new Error('Peer not initialized'));

    return new Promise((resolve, reject) => {
      const conn = this.peer!.connect(hostPeerId, {
        reliable: true,
      });

      // Timeout for connection
      const timeout = setTimeout(() => {
        conn.close();
        reject(new Error('Host connection timed out. Verify the room code is correct.'));
      }, 8000);

      conn.on('open', () => {
        clearTimeout(timeout);
        this.connections[hostPeerId] = conn;
        
        // Listen to remote events
        conn.on('data', (data: any) => {
          if (this.onData) {
            this.onData(hostPeerId, data as NetworkMessage);
          }
        });

        conn.on('close', () => {
          this.handleDisconnect(hostPeerId);
        });

        conn.on('error', (err) => {
          console.error('Connection error:', err);
        });

        if (this.onConnectionOpen) {
          this.onConnectionOpen();
        }
        resolve();
      });

      conn.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * Sets up peer listeners as the Host
   */
  private setupHostListeners() {
    if (!this.peer) return;

    this.peer.on('connection', (conn) => {
      conn.on('open', () => {
        this.connections[conn.peer] = conn;
        
        if (this.onPlayerJoined) {
          this.onPlayerJoined(conn.peer);
        }

        conn.on('data', (data: any) => {
          if (this.onData) {
            this.onData(conn.peer, data as NetworkMessage);
          }
        });

        conn.on('close', () => {
          this.handleDisconnect(conn.peer);
        });

        conn.on('error', (err) => {
          console.error('Connection error for peer:', conn.peer, err);
        });
      });
    });

    this.peer.on('error', (err) => {
      console.error('Host peer error:', err);
      if (this.onError) {
        this.onError(`Peer Error: ${err.message}`);
      }
    });

    this.peer.on('disconnected', () => {
      console.warn('Host disconnected from signaling server, attempting reconnect...');
      this.peer?.reconnect();
    });
  }

  /**
   * Sets up peer listeners as a Client
   */
  private setupClientListeners() {
    if (!this.peer) return;

    this.peer.on('error', (err) => {
      console.error('Client peer error:', err);
      if (this.onError) {
        this.onError(`Network error: ${err.message}`);
      }
    });

    this.peer.on('disconnected', () => {
      this.peer?.reconnect();
    });
  }

  /**
   * Sends data to a specific peer or all peers depending on role
   */
  public send(message: NetworkMessage, targetPeerId?: string) {
    if (targetPeerId) {
      const conn = this.connections[targetPeerId];
      if (conn && conn.open) {
        conn.send(message);
      }
    } else {
      // Broadcast to all connections
      Object.values(this.connections).forEach((conn) => {
        if (conn && conn.open) {
          conn.send(message);
        }
      });
    }
  }

  /**
   * Handle connection closure/disconnection
   */
  private handleDisconnect(peerId: string) {
    delete this.connections[peerId];
    
    if (this.onPlayerLeft) {
      this.onPlayerLeft(peerId);
    }

    if (!this.isHost && Object.keys(this.connections).length === 0) {
      if (this.onConnectionClose) {
        this.onConnectionClose();
      }
    }
  }

  /**
   * Disconnects and destroys the PeerJS instance completely
   */
  public cleanup() {
    Object.values(this.connections).forEach((conn) => {
      try {
        conn.close();
      } catch (e) {
        console.error(e);
      }
    });
    this.connections = {};

    if (this.peer) {
      try {
        this.peer.destroy();
      } catch (e) {
        console.error(e);
      }
      this.peer = null;
    }

    this.isHost = false;
    this.roomCode = '';
    this.peerId = '';
  }
}
export const networkInstance = new MultiplayerNetwork();
export default networkInstance;
