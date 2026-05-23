import React, { useState, useEffect, useRef } from 'react';
import { 
  Crown, Play, Copy, Plus, Users, MessageSquare, Settings, Info, 
  Volume2, VolumeX, LogIn, LogOut, RefreshCw, Tv, CheckCircle, 
  Sparkles, Flame, HelpCircle
} from 'lucide-react';
import network, { ROOM_PREFIX } from './network';
import soundFX from './sound';
import { Player, Platform, ChatMessage, GameSettings } from './types';
import { CHARACTER_SKINS, getRandomFunnyName, generateMap } from './utils/gameHelpers';

interface Particle {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  alpha: number;
  life: number;
  maxLife: number;
}

interface OtherPlayerRecord {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  name: string;
  characterType: number;
  isFinished: boolean;
}

export default function App() {
  const [screen, setScreen] = useState<'home' | 'lobby' | 'playing'>('home');
  const [isInitializing, setIsInitializing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  
  const [roomInput, setRoomInput] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const [nickname, setNickname] = useState('');
  const [selectedSkinId, setSelectedSkinId] = useState(0);
  const [isSpectatorMode, setIsSpectatorMode] = useState(false);

  const [playersList, setPlayersList] = useState<Player[]>([]);
  const [lobbySettings, setLobbySettings] = useState<GameSettings>({
    mapHeight: 4000,
    gravity: 0.38,
    bounceVelocity: 11.5,
    hardcoreMode: false
  });
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [spectatorTargetId, setSpectatorTargetId] = useState<string>('auto');
  const [winnerDetails, setWinnerDetails] = useState<{ name: string; time: number; avatar: string } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameLoopRef = useRef<number | null>(null);
  const keysRef = useRef<Record<string, boolean>>({});
  
  const localPlayerPhysicsRef = useRef({
    x: 400,
    y: 50,
    vx: 0,
    vy: 0,
    heightRecord: 0,
    isFinished: false,
    finishTime: 0,
  });

  const otherPlayersRef = useRef<Record<string, OtherPlayerRecord>>({});
  const platformsRef = useRef<Platform[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const cameraYRef = useRef<number>(0);
  const freeCameraYRef = useRef<number>(0);
  const canvasDragStartRef = useRef<{ y: number; camY: number } | null>(null);
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const starsRef = useRef<{ x: number; y: number; size: number; parallax: number }[]>([]);

  const physicsSettingsRef = useRef<GameSettings>({
    mapHeight: 4000,
    gravity: 0.38,
    bounceVelocity: 11.5,
    hardcoreMode: false
  });

  const [hostPeerId, setHostPeerId] = useState<string>('');
  const isHost = network.isHost;

  const handleSoundCheck = () => {
    soundFX.playClick();
  };

  useEffect(() => {
    const stars = [];
    for (let i = 0; i < 120; i++) {
      stars.push({
        x: Math.random() * 800,
        y: Math.random() * 600,
        size: 0.5 + Math.random() * 2,
        parallax: 0.15 + Math.random() * 0.4
      });
    }
    starsRef.current = stars;
    setNickname(getRandomFunnyName());
  }, []);

  const toggleMuted = () => {
    const b = soundFX.toggleMute();
    setIsMuted(b);
  };

  const setupNetworkCallbacks = () => {
    network.onConnectionOpen = () => {
      soundFX.playClick();
      setErrorMessage('');
      setScreen('lobby');
      addChatMessage('시스템', '#a855f7', '성공적으로 방에 연결되어 대기실에 입장했습니다!', true);
    };

    network.onConnectionClose = () => {
      soundFX.playClick();
      setScreen('home');
      setErrorMessage('연결이 해제되었습니다.');
      addChatMessage('시스템', '#ef4444', '대기실 접속이 종료되었습니다.', true);
    };

    network.onError = (err) => {
      setErrorMessage(err);
      setIsInitializing(false);
    };

    network.onPlayerJoined = (peerId) => {
      soundFX.playClick();
      const simpleId = peerId.replace(ROOM_PREFIX, '');
      addChatMessage('시스템', '#10b981', `새로운 모험가(${simpleId}) 가 이동 대기 중입니다...`, true);
    };

    network.onPlayerLeft = (peerId) => {
      soundFX.playCrack();
      setPlayersList(prev => {
        const leftPlayer = prev.find(p => p.id === peerId);
        if (leftPlayer) {
          addChatMessage('시스템', '#ef4444', `${leftPlayer.name}님이 대기실에서 나갔습니다.`, true);
        }
        const updated = prev.filter(p => p.id !== peerId);
        if (isHost) {
          syncLobby(updated);
        }
        return updated;
      });

      if (otherPlayersRef.current[peerId]) {
        delete otherPlayersRef.current[peerId];
      }
    };

    network.onData = (senderPeerId, msg) => {
      switch (msg.type) {
        case 'join': {
          if (!isHost) return;
          const { name, isSpectator, characterType, color } = msg.payload;
          
          setPlayersList(prev => {
            if (prev.some(p => p.id === senderPeerId)) return prev;
            
            const newPlayer: Player = {
              id: senderPeerId,
              name,
              color,
              x: 150 + Math.random() * 500,
              y: 55,
              vx: 0,
              vy: 0,
              isReady: false,
              score: 0,
              isSpectator,
              isFinished: false,
              heightRecord: 0,
              characterType
            };
            const updated = [...prev, newPlayer];
            
            addChatMessage('대기실', color, `${name}님이 입장하셨습니다!`, true);
            syncLobby(updated);
            return updated;
          });
          break;
        }

        case 'ready': {
          if (!isHost) return;
          setPlayersList(prev => {
            const updated = prev.map(p => 
              p.id === senderPeerId ? { ...p, isReady: msg.payload.isReady } : p
            );
            syncLobby(updated);
            return updated;
          });
          break;
        }

        case 'toggle_role': {
          if (!isHost) return;
          setPlayersList(prev => {
            const updated = prev.map(p => 
              p.id === senderPeerId ? { ...p, isSpectator: msg.payload.isSpectator, isReady: false } : p
            );
            addChatMessage('시스템', '#38bdf8', `플레이어 역할이 전환되었습니다.`, true);
            syncLobby(updated);
            return updated;
          });
          break;
        }

        case 'player_state': {
          const { x, y, vx, vy, heightRecord, isFinished, finishTime } = msg.payload;
          
          if (isHost) {
            setPlayersList(prev => {
              let changed = false;
              const registered = prev.find(p => p.id === senderPeerId);
              const pName = registered?.name || otherPlayersRef.current[senderPeerId]?.name || '주민';
              const pColor = registered?.color || otherPlayersRef.current[senderPeerId]?.color || '#f43f5e';
              const pCharType = registered?.characterType ?? otherPlayersRef.current[senderPeerId]?.characterType ?? 0;

              otherPlayersRef.current[senderPeerId] = {
                x,
                y,
                vx,
                vy,
                isFinished,
                name: pName,
                color: pColor,
                characterType: pCharType,
              };

              const updated = prev.map(p => {
                if (p.id === senderPeerId) {
                  const checkVal = 
                    p.heightRecord !== heightRecord || 
                    p.isFinished !== isFinished || 
                    Math.abs(p.x - x) > 0.5 || 
                    Math.abs(p.y - y) > 0.5;

                  if (checkVal) {
                    changed = true;
                    
                    if (isFinished && !p.isFinished) {
                      addChatMessage('FINISH', p.color, `🎉 ${p.name}님이 골인했습니다! 기록: ${(finishTime / 1000).toFixed(2)}초`, true);
                      
                      if (winnerDetails === null) {
                        setWinnerDetails({ name: p.name, time: finishTime, avatar: CHARACTER_SKINS[p.characterType]?.emoji || '🏆' });
                      }
                    }
                    
                    return { ...p, x, y, vx, vy, heightRecord, isFinished, finishTime };
                  }
                }
                return p;
              });
              if (changed) {
                broadcastStateSync(updated);
              }
              return updated;
            });
          } else {
            const pName = otherPlayersRef.current[senderPeerId]?.name || '주민';
            const pColor = otherPlayersRef.current[senderPeerId]?.color || '#f43f5e';
            const pCharType = otherPlayersRef.current[senderPeerId]?.characterType ?? 0;

            otherPlayersRef.current[senderPeerId] = {
              x,
              y,
              vx,
              vy,
              isFinished,
              name: pName,
              color: pColor,
              characterType: pCharType,
            };

            setPlayersList(prev => {
              if (prev.some(p => p.id === senderPeerId)) {
                return prev.map(p => {
                  if (p.id === senderPeerId) {
                    if (isFinished && !p.isFinished) {
                      addChatMessage('FINISH', p.color, `🎉 ${p.name}님이 골인했습니다! 기록: ${(finishTime / 1000).toFixed(2)}초`, true);
                      if (winnerDetails === null) {
                        setWinnerDetails({ name: p.name, time: finishTime, avatar: CHARACTER_SKINS[p.characterType]?.emoji || '🏆' });
                      }
                    }
                    return { ...p, x, y, vx, vy, heightRecord, isFinished, finishTime };
                  }
                  return p;
                });
              } else {
                const newPlayer: Player = {
                  id: senderPeerId,
                  name: pName,
                  color: pColor,
                  isReady: true,
                  score: 0,
                  isSpectator: false,
                  characterType: pCharType,
                  x,
                  y,
                  vx,
                  vy,
                  isFinished,
                  heightRecord,
                  finishTime
                };
                return [...prev, newPlayer];
              }
            });
          }
          break;
        }

        case 'platform_break': {
          const { platformId } = msg.payload;
          platformsRef.current = platformsRef.current.map(plat => 
            plat.id === platformId ? { ...plat, broken: true } : plat
          );
          
          const brokenPlat = platformsRef.current.find(p => p.id === platformId);
          if (brokenPlat) {
            triggerSparkles(brokenPlat.x + brokenPlat.width / 2, brokenPlat.y, '#ef4444', 16);
          }

          setTimeout(() => {
            platformsRef.current = platformsRef.current.map(plat => 
              plat.id === platformId ? { ...plat, broken: false } : plat
            );
          }, 5000);

          if (isHost) {
            network.send({ type: 'platform_break', payload: { platformId } });
          }
          break;
        }

        case 'chat': {
          const text = msg.payload.text;
          const sender = playersList.find(p => p.id === senderPeerId);
          if (sender) {
            addChatMessage(sender.name, sender.color, text);
            if (isHost) {
              network.send(msg);
            }
          }
          break;
        }

        case 'lobby_sync': {
          if (isHost) return;
          const { players, settings } = msg.payload;
          setLobbySettings(settings);
          physicsSettingsRef.current = settings;
          
          const list = Object.values(players) as Player[];
          setPlayersList(list);

          list.forEach(p => {
            if (p.id !== network.peerId) {
              otherPlayersRef.current[p.id] = {
                x: p.x,
                y: p.y,
                vx: p.vx,
                vy: p.vy,
                isFinished: p.isFinished,
                name: p.name,
                color: p.color,
                characterType: p.characterType
              };
            }
          });
          break;
        }

        case 'start_game': {
          if (isHost) return;
          const { platforms } = msg.payload;
          platformsRef.current = platforms;
          
          setWinnerDetails(null);
          setScreen('playing');
          resetLocalPlayerState();
          
          addChatMessage('시스템', '#a855f7', '점프 레이스를 시작합니다! 위로 올라가세요!', true);
          break;
        }

        case 'state_sync': {
          if (isHost) return;
          const { players } = msg.payload;
          
          const list = Object.values(players) as Player[];
          setPlayersList(list);
          
          list.forEach(p => {
            if (p.id !== network.peerId) {
              if (!otherPlayersRef.current[p.id]) {
                otherPlayersRef.current[p.id] = {
                  x: p.x,
                  y: p.y,
                  vx: p.vx,
                  vy: p.vy,
                  color: p.color,
                  name: p.name,
                  characterType: p.characterType ?? 0,
                  isFinished: p.isFinished
                };
              } else {
                otherPlayersRef.current[p.id].isFinished = p.isFinished;
                otherPlayersRef.current[p.id].name = p.name;
                otherPlayersRef.current[p.id].color = p.color;
                otherPlayersRef.current[p.id].x = p.x;
                otherPlayersRef.current[p.id].y = p.y;
                otherPlayersRef.current[p.id].vx = p.vx;
                otherPlayersRef.current[p.id].vy = p.vy;
                otherPlayersRef.current[p.id].characterType = p.characterType ?? 0;
              }
            } else {
              if (p.isFinished && !localPlayerPhysicsRef.current.isFinished) {
                localPlayerPhysicsRef.current.isFinished = true;
                localPlayerPhysicsRef.current.finishTime = p.finishTime || 0;
              }
            }

            if (p.isFinished && p.finishTime) {
              if (!winnerDetails || p.finishTime < (winnerDetails.time || 9999999)) {
                setWinnerDetails({ name: p.name, time: p.finishTime, avatar: CHARACTER_SKINS[p.characterType]?.emoji || '🏆' });
              }
            }
          });
          break;
        }

        case 'reset': {
          if (isHost) return;
          setScreen('lobby');
          break;
        }
      }
    };
  };

  const addChatMessage = (senderName: string, senderColor: string, text: string, system = false) => {
    const newMsg: ChatMessage = {
      id: Math.random().toString(),
      senderName,
      senderColor,
      text,
      timestamp: Date.now(),
      system
    };
    setChatMessages(prev => [...prev.slice(-30), newMsg]);
  };

  const syncLobby = (currentPlayers: Player[]) => {
    const listMap: Record<string, Player> = {};
    currentPlayers.forEach(p => {
      listMap[p.id] = p;
    });

    network.send({
      type: 'lobby_sync',
      payload: {
        players: listMap,
        settings: lobbySettings
      }
    });
  };

  const broadcastStateSync = (currentPlayers: Player[]) => {
    const listMap: Record<string, Player> = {};
    const localPhysics = localPlayerPhysicsRef.current;
    
    currentPlayers.forEach(p => {
      if (p.id === network.peerId) {
        listMap[p.id] = {
          ...p,
          x: localPhysics.x,
          y: Math.floor(localPhysics.y),
          vx: localPhysics.vx,
          vy: localPhysics.vy,
          heightRecord: Math.max(p.heightRecord, localPhysics.heightRecord),
          isFinished: p.isFinished || localPhysics.isFinished,
          finishTime: p.isFinished || localPhysics.isFinished ? (p.finishTime || localPhysics.finishTime) : undefined
        };
      } else {
        listMap[p.id] = p;
      }
    });

    network.send({
      type: 'state_sync',
      payload: {
        players: listMap,
        platforms: platformsRef.current
      }
    });
  };

  const createHostRoom = async () => {
    if (!nickname.trim()) {
      setErrorMessage('닉네임을 입력해 주세요.');
      return;
    }
    setIsInitializing(true);
    setErrorMessage('');
    
    // Generate simple 4 digit numeric code
    const randomCode = Math.floor(1000 + Math.random() * 9000).toString();
    setHostPeerId(`${ROOM_PREFIX}${randomCode}`);

    try {
      await network.initializeHost(randomCode);
      setupNetworkCallbacks();
      
      const selfColor = CHARACTER_SKINS[selectedSkinId]?.color || '#38bdf8';
      const selfPlayer: Player = {
        id: network.peerId,
        name: nickname.trim(),
        color: selfColor,
        x: 400,
        y: 60,
        vx: 0,
        vy: 0,
        isReady: true,
        score: 0,
        isSpectator: isSpectatorMode,
        isFinished: false,
        heightRecord: 0,
        characterType: selectedSkinId
      };

      setPlayersList([selfPlayer]);
      setScreen('lobby');
      soundFX.playClick();
      addChatMessage('호스트', selfColor, `대기실을 열었습니다! 방 코드: [${randomCode}]`, true);
    } catch (err: any) {
      setErrorMessage(err.message || '방을 개설하지 못했습니다. 무작위 코드로 다시 시도해 보세요.');
      setIsInitializing(false);
    }
  };

  const joinGuestRoom = async () => {
    if (!nickname.trim()) {
      setErrorMessage('닉네임을 입력해 주세요.');
      return;
    }
    if (!roomInput.trim()) {
      setErrorMessage('참가할 방 번호 4자리를 입력해 주세요.');
      return;
    }
    setIsInitializing(true);
    setErrorMessage('');

    const targetCode = roomInput.trim();
    setHostPeerId(`${ROOM_PREFIX}${targetCode}`);

    try {
      await network.initializeClient(targetCode, nickname);
      setupNetworkCallbacks();
      
      const selfColor = CHARACTER_SKINS[selectedSkinId]?.color || '#38bdf8';
      const selfPlayer: Player = {
        id: network.peerId,
        name: nickname.trim(),
        color: selfColor,
        x: 150 + Math.random() * 500,
        y: 60,
        vx: 0,
        vy: 0,
        isReady: false,
        score: 0,
        isSpectator: isSpectatorMode,
        isFinished: false,
        heightRecord: 0,
        characterType: selectedSkinId
      };
      setPlayersList([selfPlayer]);

      network.send({
        type: 'join',
        payload: {
          name: nickname.trim(),
          isSpectator: isSpectatorMode,
          characterType: selectedSkinId,
          color: selfColor
        }
      });
    } catch (err: any) {
      setErrorMessage(err.message || '방에 연결할 수 없습니다. 방 번호를 다시 검토해 주세요.');
      setIsInitializing(false);
    }
  };

  const triggerReadyState = () => {
    if (isHost) return;
    
    const self = playersList.find(p => p.id === network.peerId);
    if (!self) return;
    
    const nextReadyState = !self.isReady;
    soundFX.playClick();
    
    setPlayersList(prev => 
      prev.map(p => p.id === network.peerId ? { ...p, isReady: nextReadyState } : p)
    );

    network.send({
      type: 'ready',
      payload: { isReady: nextReadyState }
    });
  };

  const handleRoleToggle = () => {
    const nextSpectate = !isSpectatorMode;
    setIsSpectatorMode(nextSpectate);
    soundFX.playClick();

    if (screen === 'lobby') {
      setPlayersList(prev => 
        prev.map(p => p.id === network.peerId ? { ...p, isSpectator: nextSpectate, isReady: false } : p)
      );

      network.send({
        type: 'toggle_role',
        payload: { isSpectator: nextSpectate }
      });
    }
  };

  const updateHostSettings = (updates: Partial<GameSettings>) => {
    if (!isHost) return;
    const nextSettings = { ...lobbySettings, ...updates };
    setLobbySettings(nextSettings);
    physicsSettingsRef.current = nextSettings;
    syncLobby(playersList);
  };

  const startGameByHost = () => {
    if (!isHost) return;

    const mapPlats = generateMap(lobbySettings.mapHeight);
    platformsRef.current = mapPlats;
    setWinnerDetails(null);

    network.send({
      type: 'start_game',
      payload: {
        platforms: mapPlats,
        startTime: Date.now()
      }
    });

    setScreen('playing');
    resetLocalPlayerState();
    addChatMessage('심판관', '#a855f7', '경기 선언! 최고점을 향해 등반을 시작합니다!', true);
    soundFX.playFinish();
  };

  const resetLocalPlayerState = () => {
    localPlayerPhysicsRef.current = {
      x: 150 + Math.random() * 500,
      y: 60,
      vx: 0,
      vy: 0,
      heightRecord: 0,
      isFinished: false,
      finishTime: 0
    };
    cameraYRef.current = 0;
    particlesRef.current = [];
  };

  const exitRoom = () => {
    soundFX.playClick();
    network.cleanup();
    setPlayersList([]);
    setScreen('home');
    setWinnerDetails(null);
    setIsInitializing(false);
  };

  const returnToLobbyByHost = () => {
    if (!isHost) return;
    network.send({ type: 'reset', payload: { settings: lobbySettings } });
    setScreen('lobby');
    soundFX.playFinish();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysRef.current[e.code] = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.code] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const triggerSparkles = (x: number, y: number, color: string, count = 10) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 3.5;
      particlesRef.current.push({
        id: Math.random().toString(),
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.4,
        color,
        size: 2.5 + Math.random() * 3.5,
        alpha: 1,
        life: 0,
        maxLife: 20 + Math.random() * 20
      });
    }
  };

  const triggerJumpDust = (x: number, y: number, color: string) => {
    for (let i = 0; i < 9; i++) {
      const angle = (i / 9) * Math.PI * 2;
      const speed = 2.0;
      particlesRef.current.push({
        id: Math.random().toString(),
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.5 - 0.2,
        color,
        size: 3.5,
        alpha: 1,
        life: 0,
        maxLife: 15
      });
    }
  };

  useEffect(() => {
    if (screen !== 'playing') {
      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current);
        gameLoopRef.current = null;
      }
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const myId = network.peerId;
    const selfIsSpectating = isSpectatorMode;

    const gameFrameLoop = () => {
      const localPhysics = localPlayerPhysicsRef.current;
      const settings = physicsSettingsRef.current;
      const keys = keysRef.current;
      const stars = starsRef.current;
      const isFin = localPhysics.isFinished;

      platformsRef.current = platformsRef.current.map(plat => {
        if (plat.type === 'moving') {
          let nx = plat.x + (plat.speed || 0) * (plat.direction || 1);
          let ndir = plat.direction || 1;
          
          if (plat.rangeX) {
            if (nx <= plat.rangeX[0]) {
              nx = plat.rangeX[0];
              ndir = 1;
            } else if (nx >= plat.rangeX[1]) {
              nx = plat.rangeX[1];
              ndir = -1;
            }
          }
          return { ...plat, x: nx, direction: ndir };
        }
        return plat;
      });

      if (!selfIsSpectating) {
        if (keys['ArrowLeft'] || keys['KeyA']) {
          localPhysics.vx = Math.max(-5.5, localPhysics.vx - 0.45);
        } else if (keys['ArrowRight'] || keys['KeyD']) {
          localPhysics.vx = Math.min(5.5, localPhysics.vx + 0.45);
        } else {
          localPhysics.vx *= 0.84;
        }

        localPhysics.vy -= settings.gravity;
        localPhysics.x += localPhysics.vx;
        localPhysics.y += localPhysics.vy;

        if (localPhysics.x < -8) {
          localPhysics.x = 800;
        } else if (localPhysics.x > 808) {
          localPhysics.x = 0;
        }

        if (!isFin) {
          const roundedH = Math.floor(localPhysics.y);
          if (roundedH > localPhysics.heightRecord) {
            localPhysics.heightRecord = roundedH;
          }
        }

        if (localPhysics.y <= 40) {
          localPhysics.y = 40;
          localPhysics.vy = 0;
          localPhysics.vx *= 0.8;
          
          if (keys['Space'] || keys['ArrowUp'] || keys['KeyW']) {
            localPhysics.vy = settings.bounceVelocity;
            soundFX.playJump();
            triggerJumpDust(localPhysics.x, 40, '#a855f7');
          }
        }

        if (localPhysics.vy <= 0) {
          const halfSizeW = 11;
          const feetY = localPhysics.y;
          const prevFeetY = localPhysics.y - localPhysics.vy;

          for (let i = 0; i < platformsRef.current.length; i++) {
            const plat = platformsRef.current[i];
            if (plat.broken) continue;

            const isStanding = (
              localPhysics.x + halfSizeW >= plat.x &&
              localPhysics.x - halfSizeW <= plat.x + plat.width &&
              prevFeetY >= plat.y &&
              feetY <= plat.y
            );

            if (isStanding) {
              localPhysics.y = plat.y;
              
              if (plat.type === 'bounce') {
                localPhysics.vy = settings.bounceVelocity * 1.75;
                soundFX.playSpring();
                triggerJumpDust(localPhysics.x, plat.y, '#eab308');
              } else if (plat.type === 'fragile') {
                localPhysics.vy = settings.bounceVelocity * 0.95;
                soundFX.playCrack();
                triggerSparkles(localPhysics.x, plat.y, '#f87171', 12);
                
                network.send({
                  type: 'platform_break',
                  payload: { platformId: plat.id }
                });
                
                plat.broken = true;
                const targetPlatId = plat.id;
                setTimeout(() => {
                  platformsRef.current = platformsRef.current.map(p => 
                    p.id === targetPlatId ? { ...p, broken: false } : p
                  );
                }, 5000);
              } else if (plat.type === 'moving') {
                localPhysics.vy = 0;
                localPhysics.x += (plat.speed || 0) * (plat.direction || 1);
                
                if (keys['Space'] || keys['ArrowUp'] || keys['KeyW']) {
                  localPhysics.vy = settings.bounceVelocity;
                  soundFX.playJump();
                  triggerJumpDust(localPhysics.x, plat.y, '#ec4899');
                }
              } else {
                localPhysics.vy = 0;
                if (keys['Space'] || keys['ArrowUp'] || keys['KeyW']) {
                  localPhysics.vy = settings.bounceVelocity;
                  soundFX.playJump();
                  triggerJumpDust(localPhysics.x, plat.y, '#3b82f6');
                }
              }
              break;
            }
          }
        }

        if (localPhysics.y >= settings.mapHeight && !isFin) {
          localPhysics.isFinished = true;
          localPhysics.vy = 5;
          const stopTimer = Date.now() - (lobbySettings.mapHeight || Date.now());
          localPhysics.finishTime = stopTimer;
          soundFX.playFinish();

          network.send({
            type: 'player_state',
            payload: {
              x: localPhysics.x,
              y: localPhysics.y,
              vx: localPhysics.vx,
              vy: localPhysics.vy,
              heightRecord: localPhysics.heightRecord,
              isFinished: true,
              finishTime: stopTimer
            }
          });
        }

        network.send({
          type: 'player_state',
          payload: {
            x: localPhysics.x,
            y: localPhysics.y,
            vx: localPhysics.vx,
            vy: localPhysics.vy,
            heightRecord: localPhysics.heightRecord,
            isFinished: localPhysics.isFinished,
            finishTime: localPhysics.isFinished ? localPhysics.finishTime : undefined
          }
        });
      }

      if (selfIsSpectating && spectatorTargetId === 'free') {
        if (keys['ArrowUp'] || keys['KeyW']) {
          freeCameraYRef.current = Math.min(settings.mapHeight - 40, freeCameraYRef.current + 8);
        }
        if (keys['ArrowDown'] || keys['KeyS']) {
          freeCameraYRef.current = Math.max(0, freeCameraYRef.current - 8);
        }
        cameraYRef.current += (freeCameraYRef.current - cameraYRef.current) * 0.15;
      } else {
        let focusY = localPhysics.y;

        if (selfIsSpectating) {
          if (spectatorTargetId === 'auto') {
            let leadingY = 40;
            Object.values(otherPlayersRef.current).forEach((op: any) => {
              if (op && typeof op.y === 'number' && op.y > leadingY) {
                leadingY = op.y;
              }
            });
            focusY = leadingY;
          } else {
            let foundY = 40;
            if (spectatorTargetId === myId) {
              foundY = localPhysics.y;
            } else if (otherPlayersRef.current[spectatorTargetId]) {
              foundY = otherPlayersRef.current[spectatorTargetId].y;
            }
            focusY = foundY;
          }
        }

        const targetCamY = Math.max(0, focusY - 320);
        cameraYRef.current += (targetCamY - cameraYRef.current) * 0.1;

        const maxCameraYLimit = settings.mapHeight - 40;
        if (cameraYRef.current > maxCameraYLimit) {
          cameraYRef.current = maxCameraYLimit;
        }

        freeCameraYRef.current = cameraYRef.current;
      }

      const cameraY = cameraYRef.current;

      particlesRef.current = particlesRef.current.map(part => {
        return {
          ...part,
          x: part.x + part.vx,
          y: part.y + part.vy,
          life: part.life + 1,
          alpha: Math.max(0, 1 - part.life / part.maxLife)
        };
      }).filter(part => part.life < part.maxLife);

      ctx.clearRect(0, 0, 800, 600);
      ctx.fillStyle = '#0b0f19';
      ctx.fillRect(0, 0, 800, 600);

      stars.forEach(star => {
        const starY = (star.y + cameraY * star.parallax) % 600;
        ctx.fillStyle = `rgba(255, 255, 255, ${0.15 + (star.parallax * 0.6)})`;
        ctx.beginPath();
        ctx.arc(star.x, starY, star.size, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.strokeStyle = 'rgba(56, 189, 248, 0.04)';
      ctx.lineWidth = 1;
      const gridSpacing = 80;
      const startGridY = cameraY % gridSpacing;
      for (let gy = 600 + startGridY; gy >= 0; gy -= gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(800, gy);
        ctx.stroke();
      }

      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      const round100Step = Math.floor(cameraY / 200) * 200;
      for (let hMarker = round100Step; hMarker < cameraY + 650; hMarker += 200) {
        if (hMarker > settings.mapHeight) continue;
        const cy = 600 - (hMarker - cameraY);
        ctx.fillText(`${hMarker}m`, 8, cy - 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.beginPath();
        ctx.moveTo(40, cy);
        ctx.lineTo(800, cy);
        ctx.stroke();
      }

      platformsRef.current.forEach(plat => {
        if (plat.broken) return;

        const canvasPlatY = 600 - (plat.y - cameraY);
        if (canvasPlatY < -40 || canvasPlatY > 640) return;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(plat.x + 3, canvasPlatY + 3, plat.width, plat.height);

        ctx.fillStyle = plat.color;
        ctx.beginPath();
        ctx.roundRect(plat.x, canvasPlatY, plat.width, plat.height, 5);
        ctx.fill();

        if (plat.type === 'normal') {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
          ctx.fillRect(plat.x, canvasPlatY, plat.width, 3);
        } else if (plat.type === 'bounce') {
          ctx.fillStyle = '#fef08a';
          ctx.fillRect(plat.x + 12, canvasPlatY, plat.width - 24, 4);
          
          ctx.strokeStyle = '#1e293b';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(plat.x + 15, canvasPlatY + 6);
          ctx.lineTo(plat.x + plat.width - 15, canvasPlatY + 6);
          ctx.stroke();
        } else if (plat.type === 'moving') {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
          ctx.font = 'bold 9px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText('⚡ MOVING ⚡', plat.x + plat.width / 2, canvasPlatY + 11);
        } else if (plat.type === 'fragile') {
          ctx.strokeStyle = '#f87171';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(plat.x + 10, canvasPlatY + 5);
          ctx.lineTo(plat.x + plat.width - 15, canvasPlatY + 11);
          ctx.stroke();
        }
      });

      const finishLineY = 600 - (settings.mapHeight - cameraY);
      if (finishLineY > -200 && finishLineY < 800) {
        const gradientGate = ctx.createLinearGradient(0, finishLineY - 40, 0, finishLineY);
        gradientGate.addColorStop(0, 'rgba(168, 85, 247, 0.15)');
        gradientGate.addColorStop(1, 'rgba(168, 85, 247, 0.0)');
        ctx.fillStyle = gradientGate;
        ctx.fillRect(0, finishLineY - 40, 800, 40);

        ctx.strokeStyle = '#c084fc';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(0, finishLineY);
        ctx.lineTo(800, finishLineY);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#facc15';
        ctx.font = 'bold 15px Space Grotesk, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('👑 THE PEAK - FINISH LINE 👑', 400, finishLineY - 14);
      }

      particlesRef.current.forEach(part => {
        const py = 600 - (part.y - cameraY);
        ctx.save();
        ctx.globalAlpha = part.alpha;
        ctx.fillStyle = part.color;
        ctx.beginPath();
        ctx.arc(part.x, py, part.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      const drawPlayerAvatarObj = (idStr: string, nameStr: string, colorStr: string, pX: number, pY: number, pVx: number, pVy: number, charId: number, isSelfFlag: boolean) => {
        const py = 600 - (pY - cameraY);
        if (py < -50 || py > 650) return;

        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath();
        ctx.arc(pX, py - 4, 11, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = colorStr;
        ctx.beginPath();
        ctx.arc(pX, py - 13, 13, 0, Math.PI * 2);
        ctx.fill();

        if (isSelfFlag) {
          ctx.strokeStyle = '#10b981';
          ctx.lineWidth = 2.5;
          ctx.stroke();
        } else {
          ctx.strokeStyle = 'rgba(255,255,255,0.45)';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }

        if (charId === 0) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.roundRect(pX - 9, py - 17, 18, 5, 2.5);
          ctx.fill();
          
          ctx.fillStyle = '#0f172a';
          ctx.beginPath();
          ctx.arc(pX - 4 + (pVx > 0 ? 1 : pVx < 0 ? -1 : 0), py - 14.5, 1.5, 0, Math.PI * 2);
          ctx.arc(pX + 4 + (pVx > 0 ? 1 : pVx < 0 ? -1 : 0), py - 14.5, 1.5, 0, Math.PI * 2);
          ctx.fill();
        } else if (charId === 1) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(pX, py - 16, 6, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#000000';
          const slimeLookX = pVx > 1 ? 1.5 : pVx < -1 ? -1.5 : 0;
          ctx.beginPath();
          ctx.arc(pX + slimeLookX, py - 16, 2.5, 0, Math.PI * 2);
          ctx.fill();
        } else if (charId === 2) {
          ctx.strokeStyle = '#cbd5e1';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(pX - 5, py - 25);
          ctx.lineTo(pX - 5, py - 30);
          ctx.moveTo(pX + 5, py - 25);
          ctx.lineTo(pX + 5, py - 30);
          ctx.stroke();

          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.arc(pX - 5, py - 31, 2, 0, Math.PI * 2);
          ctx.arc(pX + 5, py - 31, 2, 0, Math.PI * 2);
          ctx.fill();
        } else if (charId === 3) {
          ctx.fillStyle = '#facc15';
          ctx.beginPath();
          ctx.moveTo(pX - 7, py - 24);
          ctx.lineTo(pX, py - 19);
          ctx.lineTo(pX + 7, py - 24);
          ctx.lineTo(pX + 3, py - 17);
          ctx.lineTo(pX - 3, py - 17);
          ctx.fill();
        } else if (charId === 4) {
          ctx.fillStyle = colorStr;
          ctx.beginPath();
          ctx.moveTo(pX - 11, py - 22);
          ctx.lineTo(pX - 5, py - 25);
          ctx.lineTo(pX - 2, py - 20);
          ctx.lineTo(pX + 2, py - 20);
          ctx.lineTo(pX + 5, py - 25);
          ctx.lineTo(pX + 11, py - 22);
          ctx.fill();
        }

        if (charId !== 1) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(pX - 4, py - 12, 3, 0, Math.PI * 2);
          ctx.arc(pX + 4, py - 12, 3, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#000000';
          const pupilsX = pVx > 1 ? 1.2 : pVx < -1 ? -1.2 : 0;
          const pupilsY = pVy > 1 ? -1 : pVy < -1 ? 1 : 0;
          ctx.beginPath();
          ctx.arc(pX - 4 + pupilsX, py - 12 + pupilsY, 1.2, 0, Math.PI * 2);
          ctx.arc(pX + 4 + pupilsX, py - 12 + pupilsY, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = isSelfFlag ? '#10b981' : '#f8fafc';
        ctx.font = isSelfFlag ? 'bold 11px Space Grotesk, sans-serif' : '11px Space Grotesk, sans-serif';
        ctx.textAlign = 'center';
        
        const finishIcon = otherPlayersRef.current[idStr]?.isFinished 
          ? '🏁 ' 
          : (idStr === myId && isFin) ? '🏁 ' : '';

        ctx.fillText(`${finishIcon}${nameStr}`, pX, py - 31);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.fillText(`${Math.floor(pY)}m`, pX, py + 11);
      };

      if (!selfIsSpectating) {
        const selfSkinSpec = CHARACTER_SKINS[selectedSkinId];
        drawPlayerAvatarObj(
          myId, 
          nickname || '나', 
          selfSkinSpec?.color || '#38bdf8',
          localPhysics.x,
          localPhysics.y,
          localPhysics.vx,
          localPhysics.vy,
          selectedSkinId,
          true
        );
      }

      Object.entries(otherPlayersRef.current).forEach(([pId, op]: [string, OtherPlayerRecord]) => {
        if (pId === myId) return;
        drawPlayerAvatarObj(
          pId,
          op.name,
          op.color,
          op.x,
          op.y,
          op.vx,
          op.vy,
          op.characterType ?? 0,
          false
        );
      });

      gameLoopRef.current = requestAnimationFrame(gameFrameLoop);
    };

    gameLoopRef.current = requestAnimationFrame(gameFrameLoop);
    return () => {
      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current);
      }
    };
  }, [screen, selectedSkinId, isSpectatorMode, spectatorTargetId]);

  const handleSendChatMsg = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    soundFX.playClick();
    addChatMessage('나', CHARACTER_SKINS[selectedSkinId]?.color || '#38bdf8', chatInput.trim());
    
    network.send({
      type: 'chat',
      payload: { text: chatInput.trim() }
    });
    setChatInput('');
  };

  const handleLocalScreenJump = () => {
    if (screen !== 'playing') return;
    const p = localPlayerPhysicsRef.current;
    const settings = physicsSettingsRef.current;
    
    const isSittingOnAny = p.y <= 40 || platformsRef.current.some(plat => {
      if (plat.broken) return false;
      const halfSizeW = 12;
      return (
        p.x + halfSizeW >= plat.x &&
        p.x - halfSizeW <= plat.x + plat.width &&
        Math.abs(p.y - plat.y) < 3.5
      );
    });

    if (isSittingOnAny) {
      p.vy = settings.bounceVelocity;
      soundFX.playJump();
      triggerJumpDust(p.x, p.y, '#3b82f6');
    }
  };

  const handleMobileLeft = () => {
    const p = localPlayerPhysicsRef.current;
    p.vx = Math.max(-5.5, p.vx - 2.5);
  };

  const handleMobileRight = () => {
    const p = localPlayerPhysicsRef.current;
    p.vx = Math.min(5.5, p.vx + 2.5);
  };

  return (
    <div className="min-h-screen bg-slate-950 font-sans text-slate-100 flex flex-col relative overflow-x-hidden antialiased">
      <div className="absolute top-0 left-0 right-0 h-[450px] bg-purple-900/10 blur-[150px] pointer-events-none" />

      <header className="border-b border-slate-800/80 bg-slate-900/40 backdrop-blur z-20 sticky top-0">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-purple-600 to-blue-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Flame className="w-5 h-5 text-white animate-pulse" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight font-display bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                Jump UP! <span className="text-xs bg-purple-500/20 text-purple-400 font-mono px-1.5 py-0.5 rounded border border-purple-500/30">P2P MULTI</span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {screen !== 'home' && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/60 text-xs font-mono border border-slate-700/60 text-slate-300">
                <Users className="w-3.5 h-3.5 text-blue-400" />
                <span>접속됨: {playersList.length}명</span>
              </div>
            )}
            
            <button 
              onClick={toggleMuted}
              className={`p-2 rounded-lg transition-colors border ${isMuted ? 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20' : 'bg-slate-800/80 border-slate-700/60 text-slate-300 hover:bg-slate-700'}`}
              title={isMuted ? '음소거 해제' : '음소거'}
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6 flex flex-col items-center justify-center z-10">
        {errorMessage && (
          <div className="w-full max-w-md p-3.5 mb-5 rounded-xl bg-red-950/40 border border-red-500/30 text-red-200 text-sm flex items-start gap-2.5">
            <Info className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1">{errorMessage}</div>
          </div>
        )}

        {screen === 'home' && (
          <div className="w-full max-w-4xl grid md:grid-cols-12 gap-8 my-4 items-start animate-fadeIn">
            <div className="md:col-span-7 bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 shadow-xl backdrop-blur-md">
              <div className="mb-6">
                <div className="flex items-center gap-2 text-purple-400 font-semibold text-sm mb-1">
                  <Sparkles className="w-4 h-4" />
                  <span>실시간 P2P 멀티플레이어 점프 레이싱</span>
                </div>
                <h2 className="text-3xl font-extrabold tracking-tight font-display mb-2">
                  무한의 도약, <span className="bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">누가 더 높이?</span>
                </h2>
                <p className="text-slate-400 text-sm">
                  서버 연결 대기 없이, PeerJS P2P 통신 방식을 주축으로 하여 상대방과 1:1 디바이스 다이렉트 무한 배틀을 펼칩니다. 관전자 모드 혹은 경기 모드로 참여해 보세요.
                </p>
              </div>

              <div className="space-y-4 mb-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-400 font-mono tracking-wider uppercase block">
                    점퍼 아바타 코스튬 선택
                  </label>
                  <span className="text-xs text-purple-400 font-medium">실시간 움직임에 맞춰 얼굴 표정이 갱신됩니다</span>
                </div>

                <div className="grid grid-cols-5 gap-2.5">
                  {CHARACTER_SKINS.map((skin) => (
                    <button
                      key={skin.id}
                      onClick={() => {
                        setSelectedSkinId(skin.id);
                        soundFX.playClick();
                      }}
                      className={`relative p-3.5 rounded-xl border flex flex-col items-center justify-center gap-1.5 transition-all outline-none ${
                        selectedSkinId === skin.id 
                          ? 'bg-purple-600/20 border-purple-500 shadow-md shadow-purple-500/10 scale-[1.03]' 
                          : 'bg-slate-800/40 border-slate-700/50 hover:bg-slate-800/80 hover:border-slate-600'
                      }`}
                    >
                      <span className="text-2xl filter drop-shadow">{skin.emoji}</span>
                      <span className="text-[10px] font-bold text-slate-300 truncate max-w-full text-center">
                        {skin.name}
                      </span>
                      {selectedSkinId === skin.id && (
                        <div className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-purple-500 border border-slate-900 flex items-center justify-center">
                          <CheckCircle className="w-2.5 h-2.5 text-white" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>

                <div className="p-3 bg-slate-950/80 border border-slate-800/80 rounded-xl flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg flex items-center justify-center text-2xl" style={{ backgroundColor: CHARACTER_SKINS[selectedSkinId]?.color + '15' }}>
                    <span style={{ color: CHARACTER_SKINS[selectedSkinId]?.color }}>
                      {CHARACTER_SKINS[selectedSkinId]?.emoji}
                    </span>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-200" style={{ color: CHARACTER_SKINS[selectedSkinId]?.color }}>
                      {CHARACTER_SKINS[selectedSkinId]?.name}
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      {CHARACTER_SKINS[selectedSkinId]?.description}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between p-3.5 bg-slate-800/20 rounded-xl border border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className={`p-1.5 rounded-lg ${isSpectatorMode ? 'bg-blue-500/10 text-blue-400' : 'bg-green-500/10 text-green-400'}`}>
                    <Tv className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-200">
                      {isSpectatorMode ? '배틀 중계 전용 모드' : '배틀 참가 선수 모드'}
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      {isSpectatorMode ? '경기에 직접 출전하지 않고, 높은 선수의 고도를 밀착 모티터링합니다.' : '직접 키보드로 발판을 도약하며 완등을 기록하기 위해 도전합니다.'}
                    </p>
                  </div>
                </div>

                <button
                  onClick={handleRoleToggle}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                    isSpectatorMode 
                      ? 'bg-blue-600 text-white border-blue-500 hover:bg-blue-500' 
                      : 'bg-green-600/10 text-green-400 border-green-500/30 hover:bg-green-600/20'
                  }`}
                >
                  {isSpectatorMode ? '중계 모드 고정' : '플레이어 전환'}
                </button>
              </div>

              <div className="mt-4 flex items-center gap-2 text-[11px] text-slate-500">
                <HelpCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>키보드 방향키(←, →), 또는 A/D 키 및 스페이스바 입력을 완전 지원합니다.</span>
              </div>
            </div>

            <div className="md:col-span-5 space-y-6">
              <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 shadow-xl backdrop-blur-md">
                <blockquote className="border-l-2 border-purple-500 pl-3 mb-4">
                  <p className="text-xs font-bold text-purple-400 mb-0.5">선수 닉네임 등록</p>
                  <p className="text-[11px] text-slate-400">경쟁 상황 및 메세지에 연동될 대표 명칭</p>
                </blockquote>

                <div className="relative">
                  <input
                    type="text"
                    maxLength={13}
                    placeholder="레이서 명칭..."
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-purple-500 text-slate-200 transition-colors pr-10"
                  />
                  <button
                    onClick={() => {
                      setNickname(getRandomFunnyName());
                      soundFX.playClick();
                    }}
                    className="absolute right-2.5 top-2.5 p-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 shadow-xl backdrop-blur-md space-y-5">
                <div className="space-y-2">
                  <h3 className="text-xs font-bold text-slate-400 font-mono tracking-wider uppercase">방장으로 신규 방 오픈</h3>
                  <button
                    disabled={isInitializing}
                    onClick={createHostRoom}
                    className="w-full h-11 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-sm tracking-tight flex items-center justify-center gap-2 "
                  >
                    {isInitializing ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                    <span>내 대기소 개설하기 (Create)</span>
                  </button>
                </div>

                <div className="relative flex items-center justify-center">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-800/80" />
                  </div>
                  <span className="relative px-3 text-[10px] font-mono tracking-widest text-slate-500 bg-slate-950 rounded-full">OR</span>
                </div>

                <div className="space-y-2.5">
                  <h3 className="text-xs font-bold text-slate-400 font-mono tracking-wider uppercase">동료 초대 코드 4자리 입력</h3>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      maxLength={4}
                      placeholder="초대번호..."
                      value={roomInput}
                      onChange={(e) => setRoomInput(e.target.value.replace(/[^0-9]/g, ''))}
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3.5 text-center font-mono text-base tracking-widest focus:outline-none focus:border-blue-500 text-blue-400 transition-colors"
                    />
                    <button
                      disabled={isInitializing}
                      onClick={joinGuestRoom}
                      className="px-5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs flex items-center justify-center gap-1.5"
                    >
                      {isInitializing ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <LogIn className="w-3.5 h-3.5 text-blue-400" />
                      )}
                      <span>입장</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {screen === 'lobby' && (
          <div className="w-full max-w-5xl grid md:grid-cols-12 gap-6 my-2 items-start">
            <div className="md:col-span-8 space-y-6 animate-fadeIn">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs text-blue-400 font-mono">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-ping" />
                    <span>실시간 도약 기어 온라인</span>
                  </div>
                  <h2 className="text-2xl font-bold font-display">
                    P2P 대기방 <span className="text-purple-400">#{network.roomCode}</span>
                  </h2>
                  <p className="text-xs text-slate-400">
                    아래 생성된 초대 코드를 다른 플레이어에게 전달하여 즉각 동일 레벨로 실시간 배틀을 시작하세요.
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-center min-w-[120px]">
                    <span className="block text-[10px] text-slate-500 font-bold tracking-widest uppercase mb-0.5">ROOM CODE</span>
                    <span className="text-2xl font-black font-mono tracking-widest text-[#38bdf8] block">
                      {network.roomCode}
                    </span>
                  </div>

                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(network.roomCode);
                      soundFX.playClick();
                      setCopiedCode(true);
                      setTimeout(() => setCopiedCode(false), 2000);
                    }}
                    className={`h-12 px-4 rounded-xl font-bold text-xs flex items-center gap-2 transition-colors border ${
                      copiedCode 
                        ? 'bg-green-500/10 border-green-500/30 text-green-400' 
                        : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                    }`}
                  >
                    <Copy className="w-4 h-4" />
                    <span>{copiedCode ? '복사완료' : '코드 복사'}</span>
                  </button>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
                <h3 className="text-sm font-bold text-slate-400 font-mono tracking-wider uppercase mb-4 flex items-center justify-between">
                  <span>대기실 수용 명단 ({playersList.length}명)</span>
                  <span className="text-xs text-slate-500 font-normal">PeerJS P2P Direct Mesh Connection</span>
                </h3>

                <div className="grid sm:grid-cols-2 gap-3">
                  {playersList.map((player) => {
                    const skin = CHARACTER_SKINS[player.characterType] || CHARACTER_SKINS[0];
                    const isLocal = player.id === network.peerId;
                    
                    return (
                      <div 
                        key={player.id}
                        className={`p-4 rounded-xl border flex items-center justify-between gap-3 ${
                          isLocal 
                            ? 'bg-slate-800/40 border-slate-700 shadow-inner' 
                            : 'bg-slate-900 border-slate-800/80'
                        }`}
                      >
                        <div className="flex items-center gap-3 truncate">
                          <div className="h-11 w-11 rounded-lg flex items-center justify-center text-2xl relative" style={{ backgroundColor: player.color + '10', border: `1.5px solid ${player.color}40` }}>
                            <span>{skin?.emoji}</span>
                          </div>
                          <div className="truncate">
                            <span className="text-xs font-mono text-slate-500 block">
                              {player.id === hostPeerId ? '👑 ROOM HOST' : 'PARTICIPANT'}
                              {isLocal && <span className="text-emerald-400 text-[10px] ml-1.5">● 나</span>}
                            </span>
                            <span className="text-sm font-bold text-slate-200 block truncate" style={{ color: player.color }}>
                              {player.name}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {player.isSpectator ? (
                            <span className="px-2.5 py-1 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-bold flex items-center gap-1.5 font-mono">
                              <Tv className="w-3 h-3" />
                              <span>관전</span>
                            </span>
                          ) : (
                            <span className={`px-2.5 py-1 rounded text-[10px] font-bold tracking-tight border flex items-center gap-1.5 ${
                              player.id === hostPeerId || player.isReady
                                ? 'bg-green-500/10 border-green-500/20 text-green-400' 
                                : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
                            }`}>
                              {player.id === hostPeerId || player.isReady ? (
                                <>
                                  <CheckCircle className="w-3 h-3" />
                                  <span>준비 완료</span>
                                </>
                              ) : (
                                <>
                                  <span className="h-1.5 w-1.5 rounded-full bg-yellow-500 animate-pulse" />
                                  <span>출발 대기</span>
                                </>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-6 flex flex-wrap gap-3 pt-5 border-t border-slate-800/60">
                  {!isHost && (
                    <button
                      onClick={triggerReadyState}
                      className={`h-11 px-6 rounded-xl font-bold text-sm flex items-center gap-2 cursor-pointer transition-transform active:scale-[0.98] ${
                        playersList.find(p => p.id === network.peerId)?.isReady 
                          ? 'bg-yellow-600 hover:bg-yellow-500 text-white' 
                          : 'bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-500/10'
                      }`}
                    >
                      <CheckCircle className="w-4 h-4" />
                      <span>{playersList.find(p => p.id === network.peerId)?.isReady ? '준비 해제' : '경기 참가 준비 확정'}</span>
                    </button>
                  )}

                  <button
                    onClick={handleRoleToggle}
                    className="h-11 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs border border-slate-700 flex items-center gap-2"
                  >
                    <Tv className="w-4 h-4 text-blue-400" />
                    <span>{isSpectatorMode ? '선수 출전 전환' : '중계 중립 전환'}</span>
                  </button>

                  <button
                    onClick={handleSoundCheck}
                    className="h-11 px-4 rounded-xl bg-slate-800/40 hover:bg-slate-800/80 text-slate-400 hover:text-slate-200 border border-slate-800 font-bold text-xs flex items-center gap-1.5 ml-auto"
                  >
                    <span>🔊 오디오 기능 자가 체크</span>
                  </button>
                  
                  <button
                    onClick={exitRoom}
                    className="h-11 px-4 rounded-xl bg-red-650 hover:bg-red-600 text-white font-bold text-xs flex items-center gap-2"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>연결 종료</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="md:col-span-4 space-y-6">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
                <blockquote className="border-l-2 border-purple-500 pl-3 mb-4 flex items-center gap-1.5">
                  <div>
                    <p className="text-xs font-bold text-slate-400 font-mono tracking-wider uppercase">경기 맵 옵션 제어 데크</p>
                    <p className="text-[10px] text-slate-500">
                      {isHost ? '대기실 개설자(호스트) 권한 조정 구역' : '호스트가 지정한 게임 레벨 규격 사양'}
                    </p>
                  </div>
                </blockquote>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400 font-medium">최종 완등 목표 고도</span>
                      <span className="text-purple-400 font-bold font-mono">{lobbySettings.mapHeight}m</span>
                    </div>
                    <input
                      type="range"
                      min={1500}
                      max={7500}
                      step={3005} 
                      disabled={!isHost}
                      value={lobbySettings.mapHeight}
                      onChange={(e) => updateHostSettings({ mapHeight: parseInt(e.target.value) })}
                      className="w-full accent-purple-500 cursor-pointer disabled:opacity-50"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400 font-medium">코즈믹 행성 중력</span>
                      <span className="text-blue-400 font-bold font-mono">{lobbySettings.gravity}G</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        { label: '저중력 (달)', gravityVal: 0.28 },
                        { label: '표준 중력', gravityVal: 0.38 },
                        { label: '고중력 (목성)', gravityVal: 0.52 },
                      ].map((item, idx) => (
                        <button
                          key={idx}
                          disabled={!isHost}
                          onClick={() => updateHostSettings({ gravity: item.gravityVal })}
                          className={`py-1.5 rounded-lg text-[10px] font-bold border transition-colors ${
                            lobbySettings.gravity === item.gravityVal 
                              ? 'bg-blue-500/20 border-blue-400 text-blue-300' 
                              : 'bg-slate-800/60 border-slate-800 text-slate-400 hover:bg-slate-800'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {isHost ? (
                    <button
                      onClick={startGameByHost}
                      className="w-full h-11 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold text-sm tracking-wide rounded-xl flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-600/10 animate-pulse mt-4"
                    >
                      <Play className="w-4 h-4 text-white shrink-0 fill-current" />
                      <span>도약 레이스 출발 신호 송신!</span>
                    </button>
                  ) : (
                    <div className="p-3 text-center rounded-xl bg-slate-950/60 border border-slate-800/60 text-slate-500 text-[11px] font-medium leading-relaxed">
                      ⏳ 호스트가 레이스를 출발하면 화면이 자동으로 전장으로 이동합니다.
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-col h-[280px]">
                <h3 className="text-xs font-bold text-slate-400 font-mono tracking-wider uppercase mb-2 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
                  <span>실시간 채팅 채널</span>
                </h3>

                <div className="flex-1 overflow-y-auto space-y-1.5 pr-1.5 py-1 mb-2">
                  {chatMessages.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-[11px] text-slate-600 text-center italic">
                      참가자들과 전략 대화를 주고받아 보세요.
                    </div>
                  ) : (
                    chatMessages.map(msg => (
                      <div key={msg.id} className="text-xs leading-relaxed break-all">
                        {msg.system ? (
                          <span className="text-[10px] bg-slate-800 py-0.5 px-1.5 rounded text-indigo-300 font-medium">
                            {msg.text}
                          </span>
                        ) : (
                          <>
                            <strong className="mr-1.5" style={{ color: msg.senderColor }}>{msg.senderName}:</strong>
                            <span className="text-slate-300">{msg.text}</span>
                          </>
                        )}
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={handleSendChatMsg} className="flex gap-1.5 pt-2 border-t border-slate-800/80">
                  <input
                    type="text"
                    maxLength={35}
                    placeholder="도발 멘트 입력..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
                  />
                  <button 
                    type="submit"
                    className="px-3 bg-purple-600 hover:bg-purple-500 rounded-lg text-white font-bold text-xs"
                  >
                    전송
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {screen === 'playing' && (
          <div className="w-full max-w-7xl grid lg:grid-cols-12 gap-6 items-start my-1 text-slate-200">
            <div className="lg:col-span-12 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-ping" />
                <div>
                  <h3 className="text-lg font-black font-display tracking-tight text-white flex items-center gap-1.5">
                    <span>LIVE - 정상을 향해 무한 도약 레이스</span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    전체 마운틴 고도: <strong className="text-slate-200 font-mono">{lobbySettings.mapHeight}m</strong>
                  </p>
                </div>
              </div>

              {playersList.find(p => p.id === network.peerId)?.isSpectator && (
                <div className="flex items-center gap-2 bg-blue-950/40 border border-blue-500/30 px-3 py-1.5 rounded-lg">
                  <Tv className="w-4 h-4 text-blue-400 animate-pulse" />
                  <span className="text-xs text-blue-300">
                    중계 모니터 필터: 
                  </span>
                  <select
                    value={spectatorTargetId}
                    onChange={(e) => setSpectatorTargetId(e.target.value)}
                    className="bg-slate-900 text-xs border border-slate-700 rounded px-2.5 py-0.5 font-bold text-white focus:outline-none"
                  >
                    <option value="auto">🔥 선두 등반자 밀착 추적</option>
                    <option value="free">🌐 자유 시점 (드래그 & 방향키 조작)</option>
                    {playersList.filter(p => !p.isSpectator).map(p => (
                      <option key={p.id} value={p.id}>👤 {p.name} 페이스 중계</option>
                    ))}
                  </select>
                </div>
              )}

              {isHost && (
                <button
                  onClick={returnToLobbyByHost}
                  className="h-10 px-4 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs flex items-center gap-2 shadow"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>게임 강제 강등 리셋</span>
                </button>
              )}
            </div>

            <div className="lg:col-span-8 flex flex-col items-center">
              <div className="relative w-full max-w-[800px] border border-slate-800 rounded-2xl overflow-hidden bg-slate-950 shadow-2xl">
                {!isSpectatorMode && (
                  <div className="absolute top-4 left-4 z-10 bg-slate-900/80 backdrop-blur-md px-3 py-2 rounded-xl border border-slate-800 text-left">
                    <span className="text-[10px] text-slate-500 font-bold block uppercase tracking-wider">나의 완등 기어</span>
                    <span className="text-2xl font-black font-mono text-emerald-400 leading-tight">
                      {Math.floor(localPlayerPhysicsRef.current.y)}m
                    </span>
                    <span className="text-[10px] text-slate-500 block leading-tight">
                      최고 도달: {Math.floor(localPlayerPhysicsRef.current.heightRecord)}m
                    </span>
                  </div>
                )}

                {localPlayerPhysicsRef.current.isFinished && (
                  <div className="absolute inset-x-0 top-1/4 mx-auto max-w-sm z-10 bg-purple-950/90 border border-purple-500 p-6 rounded-2xl shadow-2xl text-center backdrop-blur-md animate-bounce">
                    <Crown className="w-10 h-10 text-yellow-400 mx-auto mb-2 animate-spin" />
                    <h3 className="text-xl font-bold text-white mb-1">🏁 등반 완료!</h3>
                    <p className="text-xs text-slate-300 mb-3 block">
                      정상 고지에 등반 깃발을 성공적으로 꼽았습니다!
                    </p>
                    <div className="font-mono text-lg font-black text-yellow-300 inline-block bg-slate-900/80 px-4 py-1.5 rounded-lg border border-yellow-500/30">
                      레이스 기록: {(localPlayerPhysicsRef.current.finishTime / 1000).toFixed(2)}초
                    </div>
                  </div>
                )}

                <canvas
                  id="jumpup-canvas"
                  ref={canvasRef}
                  width={800}
                  height={600}
                  onPointerDown={(e) => {
                    const selfInList = playersList.find(p => p.id === network.peerId);
                    const selfIsSpectating = selfInList?.isSpectator ?? isSpectatorMode;
                    if (!selfIsSpectating || spectatorTargetId !== 'free') return;
                    canvasDragStartRef.current = { y: e.clientY, camY: freeCameraYRef.current };
                    setIsDraggingCanvas(true);
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    if (!isDraggingCanvas || !canvasDragStartRef.current) return;
                    const deltaY = e.clientY - canvasDragStartRef.current.y;
                    // Dragging down moves camera UP (scolls upward)
                    freeCameraYRef.current = Math.max(0, Math.min(lobbySettings.mapHeight - 40, canvasDragStartRef.current.camY + deltaY));
                  }}
                  onPointerUp={(e) => {
                    setIsDraggingCanvas(false);
                    canvasDragStartRef.current = null;
                    try {
                      e.currentTarget.releasePointerCapture(e.pointerId);
                    } catch (err) {}
                  }}
                  className={`w-full h-auto max-w-[800px] aspect-[4/3] block bg-slate-950 ${
                    playersList.find(p => p.id === network.peerId)?.isSpectator && spectatorTargetId === 'free' ? 'cursor-grab active:cursor-grabbing' : ''
                  }`}
                />

                {playersList.find(p => p.id === network.peerId)?.isSpectator && spectatorTargetId === 'free' && (
                  <div className="absolute right-4 top-4 z-10 bg-slate-900/90 border border-slate-800 p-2.5 rounded-xl flex flex-col gap-1.5 pointer-events-auto shadow-2xl backdrop-blur select-none">
                    <span className="text-[10px] font-bold text-slate-400 text-center tracking-wide">수동 카메라 (드래그 가능)</span>
                    <button
                      onPointerDown={() => {
                        freeCameraYRef.current = Math.min(lobbySettings.mapHeight - 40, freeCameraYRef.current + 65);
                      }}
                      className="p-1.5 px-3 rounded bg-slate-800 hover:bg-slate-700 active:bg-purple-600 border border-slate-700 text-[10px] font-bold text-slate-100 font-mono transition-all"
                    >
                      ▲ 위로 (+65m)
                    </button>
                    <button
                      onPointerDown={() => {
                        freeCameraYRef.current = Math.max(0, freeCameraYRef.current - 65);
                      }}
                      className="p-1.5 px-3 rounded bg-slate-800 hover:bg-slate-700 active:bg-purple-600 border border-slate-700 text-[10px] font-bold text-slate-100 font-mono transition-all"
                    >
                      ▼ 아래로 (-65m)
                    </button>
                  </div>
                )}

                <div className="absolute inset-x-0 bottom-4 px-4 py-2 flex items-center justify-between pointer-events-none gap-4">
                  <div className="flex gap-2 pointer-events-auto">
                    <button 
                      onPointerDown={handleMobileLeft}
                      className="h-12 w-14 rounded-xl bg-slate-900/85 active:bg-purple-600 border border-slate-700/60 flex items-center justify-center active:scale-95 text-slate-300 font-mono font-bold select-none text-sm shadow"
                    >
                      ◀ A
                    </button>
                    <button 
                      onPointerDown={handleMobileRight}
                      className="h-12 w-14 rounded-xl bg-slate-900/85 active:bg-purple-600 border border-slate-700/60 flex items-center justify-center active:scale-95 text-slate-300 font-mono font-bold select-none text-sm shadow"
                    >
                      D ▶
                    </button>
                  </div>

                  <button
                    onPointerDown={handleLocalScreenJump}
                    className="h-12 w-24 rounded-xl bg-gradient-to-tr from-purple-700 to-indigo-700 active:scale-95 text-xs font-bold text-white tracking-widest pointer-events-auto border border-purple-500 select-none shadow-md"
                  >
                    JUMP (W)
                  </button>
                </div>
              </div>

              <div className="w-full max-w-[800px] mt-3 p-4 bg-slate-900/40 border border-slate-800/80 rounded-xl text-xs text-slate-400 leading-relaxed flex items-center gap-3">
                <span className="p-1 px-1.5 rounded bg-slate-800 text-[10px] font-mono border border-slate-700 uppercase shrink-0 text-slate-300 font-bold">INFO</span>
                <span>
                  바운스 노란 스프링 발판({CHARACTER_SKINS[3]?.emoji})에 올라타면 초가속 부스터가 적용됩니다! 부서지는 붉은 발판({CHARACTER_SKINS[4]?.emoji})은 점프 딛자마자 즉각 붕괴되어 사라지니 재빠른 터치를 요합니다.
                </span>
              </div>
            </div>

            <div className="lg:col-span-4 space-y-6">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
                <blockquote className="border-l-2 border-purple-500 pl-3 mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-slate-400 font-mono tracking-wider uppercase">등반 고도 리더보드</p>
                    <p className="text-[10px] text-slate-500">실시간 레이서간 고도 분포 차트</p>
                  </div>
                  <Crown className="w-4 h-4 text-yellow-400 animate-bounce" />
                </blockquote>

                {winnerDetails && (
                  <div className="p-3 mb-3 bg-gradient-to-r from-yellow-900/40 to-yellow-600/10 border border-yellow-500/40 rounded-xl flex items-center gap-2.5 animate-pulse">
                    <span className="text-2xl">{winnerDetails.avatar}</span>
                    <div className="text-xs">
                      <span className="font-bold text-yellow-300 block">오늘의 레이스 정복자 👑</span>
                      <span className="text-slate-300 block">
                        <strong>{winnerDetails.name}</strong> ({(winnerDetails.time / 1000).toFixed(2)}초)
                      </span>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  {playersList
                    .map(p => {
                      if (p.id === network.peerId && !p.isSpectator) {
                        return {
                          ...p,
                          y: Math.floor(localPlayerPhysicsRef.current.y),
                          heightRecord: Math.max(p.heightRecord, localPlayerPhysicsRef.current.heightRecord),
                          isFinished: p.isFinished || localPlayerPhysicsRef.current.isFinished,
                          finishTime: p.isFinished || localPlayerPhysicsRef.current.isFinished ? (p.finishTime || localPlayerPhysicsRef.current.finishTime) : undefined
                        };
                      }
                      return {
                        ...p,
                        y: Math.floor(p.y ?? 0)
                      };
                    })
                    .filter(p => !p.isSpectator)
                    .sort((a, b) => {
                      if (a.isFinished && b.isFinished) {
                        return (a.finishTime || 0) - (b.finishTime || 0);
                      }
                      if (a.isFinished) return -1;
                      if (b.isFinished) return 1;
                      
                      const aY = a.y || 0;
                      const bY = b.y || 0;
                      if (bY !== aY) return bY - aY;
                      return b.heightRecord - a.heightRecord;
                    })
                    .map(p => {
                      const currentHeightVal = p.isFinished ? lobbySettings.mapHeight : Math.floor(p.y || 0);
                      const percentage = Math.min(100, Math.max(0, (currentHeightVal / lobbySettings.mapHeight) * 100));
                      const isMe = p.id === network.peerId;
                      const hasFinished = p.isFinished;
                      
                      return (
                        <div 
                          key={p.id}
                          className={`p-3 rounded-lg border text-sm ${
                            isMe 
                              ? 'bg-slate-800/60 border-slate-700/60' 
                              : 'bg-slate-900/50 border-slate-900'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1 mb-1.5">
                            <span className="font-bold truncate" style={{ color: p.color }}>
                              {p.name} {isMe && <span className="text-emerald-400 text-[10px] font-normal">(나)</span>}
                            </span>
                            
                            <span className="font-mono text-xs text-slate-300 font-bold shrink-0">
                              {hasFinished ? (
                                <span className="text-yellow-400 font-bold flex items-center gap-1 font-sans text-[10px]">
                                  <CheckCircle className="w-3 h-3 text-yellow-400 fill-current" />
                                  <span>완료! ({(p.finishTime || 0) / 1000}초)</span>
                                </span>
                              ) : (
                                <span className="flex flex-col items-end gap-0.5 text-right leading-none">
                                  <span className="text-emerald-400 font-bold font-sans">현재: {Math.floor(p.y || 0)}m</span>
                                  <span className="text-[10px] text-slate-400">최고: {p.heightRecord}m</span>
                                </span>
                              )}
                            </span>
                          </div>

                          <div className="h-1.5 w-full bg-slate-950 rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full transition-all duration-300 ${
                                hasFinished 
                                  ? 'bg-gradient-to-r from-yellow-400 to-amber-500' 
                                  : 'bg-gradient-to-r from-blue-500 to-purple-500'
                              }`}
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}

                  {playersList.filter(p => !p.isSpectator).length === 0 && (
                    <div className="p-4 text-center text-xs text-slate-500 italic">
                      참가 선수가 대기방에 없습니다.
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-col h-[320px]">
                <h3 className="text-xs font-bold text-slate-400 font-mono tracking-wider uppercase mb-2 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
                  <span>실시간 매치 응원 채널</span>
                </h3>

                <div className="flex-1 overflow-y-auto space-y-1.5 pr-1.5 py-1 mb-2">
                  {chatMessages.map(msg => (
                    <div key={msg.id} className="text-xs leading-relaxed break-all">
                      {msg.system ? (
                        <span className="text-[10px] bg-slate-800 py-0.5 px-1.5 rounded text-indigo-300 font-medium">
                          {msg.text}
                        </span>
                      ) : (
                        <>
                          <strong className="mr-1" style={{ color: msg.senderColor }}>{msg.senderName}:</strong>
                          <span className="text-slate-300">{msg.text}</span>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                <form onSubmit={handleSendChatMsg} className="flex gap-1.5 pt-2 border-t border-slate-800/80">
                  <input
                    type="text"
                    maxLength={35}
                    placeholder="응원 글귀..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
                  />
                  <button 
                    type="submit"
                    className="px-3 bg-purple-600 hover:bg-purple-500 rounded-lg text-white font-bold text-xs"
                  >
                    송신
                  </button>
                </form>
              </div>

              <button
                onClick={exitRoom}
                className="w-full h-11 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs border border-slate-700 rounded-xl flex items-center justify-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                <span>대기소 퇴각</span>
              </button>
            </div>
          </div>
        )}
      </main>

      <footer className="mt-auto py-5 border-t border-slate-900/60 bg-slate-950/40 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>
            Jump UP! &copy; 2026. PeerJS Real-time P2P Puddle. No Servers Required.
          </span>
          <div className="flex items-center gap-4 text-[11px]">
            <span className="text-slate-500 animate-pulse">상태 : <span className="text-[#38bdf8]">그린 시스템 온라인</span></span>
          </div>
        </div>
      </footer>
    </div>
  );
}
