export type RelationMode = "recipes" | "fusions" | "equips";

export type GuardianName =
  | "MERCURY"
  | "SUN"
  | "MOON"
  | "VENUS"
  | "MARS"
  | "JUPITER"
  | "SATURN"
  | "URANUS"
  | "PLUTO"
  | "NEPTUNE";

export type CardDetailData = {
  schemaVersion: 2;
  parserVersion: string;
  source: {
    url: string;
    capturedAt: string;
    contentHash: string;
    upstreamName: string;
    upstreamCardType: string;
  };
  cardId: string;
  cardType: string;
  description: string;
  field: {
    cardId: string;
    name: string;
    gameName: string;
  } | null;
  guardianStars: GuardianName[];
  inGameMedia: {
    kind: "model-video" | "animated-fallback";
    status: "available" | "temporary";
    sourcePath: string | null;
    localPath: string;
    width: number;
    height: number;
    objectPosition: string;
  };
  counts: Record<RelationMode, number>;
  recipes: Array<{ left: string; right: string }>;
  fusions: Array<{ partner: string; result: string }>;
  equips: Array<{ partner: string; result: string; boost: number }>;
};

export type CardDetailManifest = {
  schemaVersion: 2;
  generatedAt: string;
  ids: string[];
  cards: Record<string, {
    path: string;
    cardType: string;
    mediaKind: CardDetailData["inGameMedia"]["kind"];
    fieldGameName: string | null;
  }>;
};
