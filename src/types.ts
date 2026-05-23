export type GameStatus = 'lobby' | 'playing' | 'ended';
export type PlatformType = 'normal' | 'bounce' | 'moving' | 'fragile';

export interface Platform {
  id: string;
  x: number;
  y: number; // Y-coordinate is absolute (growing upwards, 0 = ground)
  width: number;
  height: number;
  type: PlatformType;
  color: string;
  speed?: number;
  rangeX?: [number, number]; // Left and right bounds for moving platform
  direction?: number; // 1 or -1
  broken?: boolean; // For fragile platforms
  crackLevel?: number; // 0 to 1 for fragile platforms
}

export interface Player {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  isReady: boolean;
  score: number;
  isSpectator: boolean;
  isFinished: boolean;
  finishTime?: number; // timestamp in ms from game start
  heightRecord: number; // peak height reached
  characterType: number; // avatar design option
}

export interface ChatMessage {
  id: string;
  senderName: string;
  senderColor: string;
  text: string;
  timestamp: number;
  system?: boolean;
}

export interface GameSettings {
  mapHeight: number; // e.g., 5000px
  gravity: number; // pixel unit gravity
  bounceVelocity: number;
  hardcoreMode: boolean; // fall all the way down instead of respawn
}

export interface GameState {
  status: GameStatus;
  players: Record<string, Player>;
  platforms: Platform[];
  startTime: number | null;
  endTime: number | null;
  winnerId: string | null;
  settings: GameSettings;
}

export type NetworkMessage =
  | { type: 'join'; payload: { name: string; isSpectator: boolean; characterType: number; color: string } }
  | { type: 'lobby_sync'; payload: { players: Record<string, Player>; settings: GameSettings } }
  | { type: 'ready'; payload: { isReady: boolean } }
  | { type: 'toggle_role'; payload: { isSpectator: boolean } }
  | { type: 'start_game'; payload: { platforms: Platform[]; startTime: number } }
  | { type: 'player_state'; payload: { x: number; y: number; vx: number; vy: number; heightRecord: number; isFinished: boolean; finishTime?: number } }
  | { type: 'platform_break'; payload: { platformId: string } }
  | { type: 'state_sync'; payload: { players: Record<string, Player>; platforms: Platform[] } }
  | { type: 'chat'; payload: { text: string } }
  | { type: 'game_over'; payload: { winnerId: string; endTime: number } }
  | { type: 'reset'; payload: { settings: GameSettings } }
  | { type: 'host_update_settings'; payload: { settings: GameSettings } };
