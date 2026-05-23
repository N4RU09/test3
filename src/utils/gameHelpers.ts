import { Platform, PlatformType } from '../types';

export interface CharacterSkin {
  id: number;
  name: string;
  emoji: string;
  color: string;
  description: string;
}

export const CHARACTER_SKINS: CharacterSkin[] = [
  { id: 0, name: '아스트로 볼', emoji: '🚀', color: '#38bdf8', description: '우주 바이저 장착형 스피어' },
  { id: 1, name: '슬라임 점퍼', emoji: '👽', color: '#4ade80', description: '리얼한 리퀴드 젤리 고글 룩' },
  { id: 2, name: '사이버 보트', emoji: '🤖', color: '#fb923c', description: '듀얼 스틸 안테나 하이테크 본체' },
  { id: 3, name: '럭키 스타', emoji: '⭐', color: '#facc15', description: '빛나는 골든 스타 크라운 장식' },
  { id: 4, name: '코즈믹 캣', emoji: '🐈', color: '#c084fc', description: '네온 보라빛 냥이 특수 바디' },
];

export const FUNNY_NAMES = [
  '날으는 캥거루', '점프하는 거북이', '춤추는 슬라임', '성난 개구리', '우주 고양이',
  '빛의 스피드', '구름 위의 달리기', '슈퍼 도토리', '하이 볼텍스', '트릭스터 토끼'
];

export const getRandomFunnyName = (): string => {
  return FUNNY_NAMES[Math.floor(Math.random() * FUNNY_NAMES.length)] + ' ' + Math.floor(100 + Math.random() * 900);
};

export const generateMap = (height: number): Platform[] => {
  const platforms: Platform[] = [];

  // Base starting platform (large ground)
  platforms.push({
    id: 'ground',
    x: 0,
    y: 0,
    width: 800,
    height: 40,
    type: 'normal',
    color: '#475569',
  });

  let currentY = 126;
  let count = 0;

  while (currentY < height - 150) {
    count++;
    // Make platforms narrower as the player climbs higher!
    const width = Math.max(70, 160 - Math.floor(currentY / 45));
    const platHeight = 14;
    const x = Math.random() * (800 - width);

    let type: PlatformType = 'normal';
    let color = '#3b82f6'; // Light blue

    const rand = Math.random();
    if (currentY > 300) {
      if (rand < 0.16) {
        type = 'bounce';
        color = '#eab308'; // Glowing gold spring
      } else if (rand < 0.32) {
        type = 'moving';
        color = '#ec4899'; // Fast pink moving platform
      } else if (rand < 0.46) {
        type = 'fragile';
        color = '#ef4444'; // Red fragile crumbly platform
      }
    }

    const platform: Platform = {
      id: `p-${count}`,
      x,
      y: currentY,
      width,
      height: platHeight,
      type,
      color,
    };

    if (type === 'moving') {
      platform.speed = 1.6 + Math.random() * 1.8;
      platform.rangeX = [x, Math.min(800 - width, x + 150 + Math.random() * 150)];
      platform.direction = Math.random() > 0.5 ? 1 : -1;
    }

    platforms.push(platform);

    // Dynamic distance step between platforms (reduced by 10% to 94.5 + rand * 58.5)
    currentY += 94.5 + Math.random() * 58.5;
  }

  // Neon Finish line crown platform at the top
  platforms.push({
    id: 'finish-platform',
    x: 100,
    y: height,
    width: 600,
    height: 44,
    type: 'normal',
    color: '#a855f7', // Crown purple
  });

  return platforms;
};
