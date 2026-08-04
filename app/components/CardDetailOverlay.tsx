"use client";

import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import archiveData from "../data/cards.json";
import spriteData from "../data/minicard-sprite-map.json";
import type { CardDetailData as DetailData, GuardianName, RelationMode } from "../types/card-detail";

type Card = {
  id: string;
  name: string;
  cardType: string;
  type: string;
  level: number | null;
  attack: number | null;
  defense: number | null;
  password: string | null;
  cost: number | null;
  image: string;
};

type SpriteRect = { column: number; row: number };
type TypeSprite = { x: number; y: number; width: number; height: number };
type DigitSprite = { x: number; y: number; width: number; height: number };
type Relation = {
  key: string;
  left: Card;
  right: Card;
  result: Card;
  relevantType: string | null;
  types: string[];
  score: number;
  boost?: number;
};

type Props = {
  detailData: DetailData;
  open: boolean;
  onClose: () => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onPrefetchRelated?: (cardId: string) => void;
  onOpenRelated?: (cardId: string) => Promise<boolean>;
  returnTarget?: Pick<Card, "id" | "name"> | null;
  onReturn?: () => Promise<boolean>;
};

const cards = archiveData.cards as Card[];
const cardById = new Map(cards.map((card) => [card.id, card]));
const fusionSprites = spriteData.fusionMinicards.cards as Record<string, SpriteRect>;
const typeSprites = spriteData.main.typeIcons as Record<string, TypeSprite>;
const statDigitSprites = spriteData.main.statDigits as Record<string, DigitSprite>;
const framePositions = spriteData.frames.runtimePreset.positions as Record<string, { x: number; y: number }>;
const relationTypes = Array.from(
  new Set(cards.filter((card) => card.cardType === "Monster").map((card) => card.type)),
).sort((a, b) => a.localeCompare(b));

const MINI_CARD_SCALE = 1.1;
const STAT_SPRITE_SCALE = 1.54 * MINI_CARD_SCALE;
const RELATIONS_PER_PAGE = 6;
const FUSION_STAR_PATH = "M20 2.5L25.3 13.3L37.2 15L28.6 23.3L30.7 35.2L20 29.6L9.3 35.2L11.4 23.3L2.8 15L14.7 13.3Z";
const formatter = new Intl.NumberFormat("pt-BR");
const GUARDIAN_RELATIONS: Record<GuardianName, { strongAgainst: GuardianName; weakAgainst: GuardianName }> = {
  SUN: { strongAgainst: "MOON", weakAgainst: "MERCURY" },
  MOON: { strongAgainst: "VENUS", weakAgainst: "SUN" },
  VENUS: { strongAgainst: "MERCURY", weakAgainst: "MOON" },
  MERCURY: { strongAgainst: "SUN", weakAgainst: "VENUS" },
  MARS: { strongAgainst: "JUPITER", weakAgainst: "NEPTUNE" },
  JUPITER: { strongAgainst: "SATURN", weakAgainst: "MARS" },
  SATURN: { strongAgainst: "URANUS", weakAgainst: "JUPITER" },
  URANUS: { strongAgainst: "PLUTO", weakAgainst: "SATURN" },
  PLUTO: { strongAgainst: "NEPTUNE", weakAgainst: "URANUS" },
  NEPTUNE: { strongAgainst: "MARS", weakAgainst: "PLUTO" },
};
const GUARDIAN_SYMBOLS: Record<GuardianName, string> = {
  MERCURY: "☿", SUN: "☉", MOON: "☾", VENUS: "♀", MARS: "♂",
  JUPITER: "♃", SATURN: "♄", URANUS: "⛢", PLUTO: "♇", NEPTUNE: "♆",
};
const GUARDIAN_SPRITES = {
  MERCURY: { x: 0, y: 170 },
  SUN: { x: 0, y: 187 },
  MOON: { x: 17, y: 170 },
  VENUS: { x: 51, y: 187 },
  MARS: { x: 170, y: 153 },
  JUPITER: { x: 85, y: 153 },
  SATURN: { x: 136, y: 170 },
  URANUS: { x: 34, y: 187 },
  PLUTO: { x: 68, y: 170 },
  NEPTUNE: { x: 34, y: 170 },
} satisfies Record<GuardianName, { x: number; y: number }>;
const CARD_TYPE_ICONS: Record<string, string> = {
  Equip: "/game-assets/categories/equip-icon.png",
  Magic: "/game-assets/categories/magic-icon.png",
  Field: "/game-assets/categories/magic-icon.png",
  Ritual: "/game-assets/categories/ritual-fusion-icon.png",
  Trap: "/game-assets/categories/trap-icon.png",
};
const FIELD_BACKGROUND_BY_NAME: Record<string, string> = {
  MOUNTAIN: "/game-assets/fields/mountain_shrine.webp",
  DARK: "/game-assets/fields/dark_shrine_hall.webp",
  FOREST: "/game-assets/fields/forest_shrine.webp",
  WASTELAND: "/game-assets/fields/desert_shrine.webp",
  MEADOW: "/game-assets/fields/meadow_shrine.webp",
  SEA: "/game-assets/fields/chamber.webp",
};
const DEFAULT_FIELD_BACKGROUND = "/game-assets/fields/chamber.webp";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function typeKey(type: string) {
  return type
    .toLowerCase()
    .split(/[_ -]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(type.includes("-") ? "-" : " ");
}

function TypeSpriteIcon({ type, size = 22 }: { type: string; size?: number }) {
  const sprite = typeSprites[type] ?? typeSprites[typeKey(type)];
  if (!sprite) return <span className="detail-type-fallback" style={{ width: size, height: size }}>{type[0]}</span>;
  const scale = size / sprite.width;
  const style: CSSProperties = {
    width: size,
    height: size,
    backgroundImage: 'url("/game-assets/fusion/main.png")',
    backgroundRepeat: "no-repeat",
    backgroundSize: `${191 * scale}px ${203 * scale}px`,
    backgroundPosition: `${-sprite.x * scale}px ${-sprite.y * scale}px`,
  };
  return <span className="detail-type-sprite" style={style} aria-hidden="true" />;
}

function CardClassificationIcon({ card, size = 22 }: { card: Card; size?: number }) {
  if (card.cardType === "Monster") return <TypeSpriteIcon type={card.type} size={size} />;
  const src = CARD_TYPE_ICONS[card.cardType] ?? CARD_TYPE_ICONS.Magic;
  return <img className="detail-card-type-icon" src={src} alt="" width={size} height={size} aria-hidden="true" />;
}

function FieldSpriteIcon({ card, size = 48 }: { card: Card; size?: number }) {
  const sprite = fusionSprites[card.id];
  if (!sprite) {
    return <img className="detail-field-sprite" src={`/cards/${card.id}.webp`} alt="" aria-hidden="true" />;
  }
  const columns = 26;
  const rows = 28;
  const style: CSSProperties = {
    width: size,
    height: size,
    backgroundImage: 'url("/game-assets/fusion/cards.webp")',
    backgroundRepeat: "no-repeat",
    backgroundSize: `${columns * size}px ${rows * size}px`,
    backgroundPosition: `${-sprite.column * size}px ${-sprite.row * size}px`,
  };
  return <span className="detail-field-sprite" style={style} aria-hidden="true" />;
}

function StatNumber({ value, label }: { value: number; label: string }) {
  const text = String(Math.max(0, value));
  const hiddenCount = Math.max(0, 4 - text.length);
  const digits = `${"0".repeat(hiddenCount)}${text}`.split("");
  return (
    <span className="stat-number" role="img" aria-label={`${label} ${value}`}>
      {digits.map((digit, index) => {
        const sprite = statDigitSprites[digit] ?? statDigitSprites["0"];
        const style: CSSProperties = {
          width: 7 * STAT_SPRITE_SCALE,
          height: 8 * STAT_SPRITE_SCALE,
          backgroundImage: 'url("/game-assets/fusion/main.png")',
          backgroundRepeat: "no-repeat",
          backgroundSize: `${191 * STAT_SPRITE_SCALE}px ${203 * STAT_SPRITE_SCALE}px`,
          backgroundPosition: `${-sprite.x * STAT_SPRITE_SCALE}px ${-sprite.y * STAT_SPRITE_SCALE}px`,
        };
        return (
          <span
            className={`stat-digit${index < hiddenCount ? " hidden-digit" : ""}`}
            style={style}
            aria-hidden="true"
            key={`${index}-${digit}`}
          />
        );
      })}
    </span>
  );
}

function RelationMiniCard({
  card,
  attack,
  defense,
  showTooltip = true,
  selectionKey,
  armed = false,
  opening = false,
  current = false,
  onActivate,
}: {
  card: Card;
  attack?: number;
  defense?: number;
  showTooltip?: boolean;
  selectionKey?: string;
  armed?: boolean;
  opening?: boolean;
  current?: boolean;
  onActivate?: (card: Card, selectionKey: string) => void;
}) {
  const art = fusionSprites[card.id];
  const frame = framePositions[card.cardType] ?? framePositions.Monster;
  const finalAttack = attack ?? card.attack;
  const finalDefense = defense ?? card.defense;
  const artStyle: CSSProperties = {
    backgroundImage: 'url("/game-assets/fusion/cards.webp")',
    backgroundPosition: `${-(art?.column ?? 0) * 62.54 * MINI_CARD_SCALE}px ${-(art?.row ?? 0) * 56.64 * MINI_CARD_SCALE}px`,
  };
  const frameStyle: CSSProperties = {
    backgroundImage: 'url("/game-assets/fusion/frames.webp")',
    backgroundPosition: `${frame.x * MINI_CARD_SCALE}px ${frame.y * MINI_CARD_SCALE}px`,
  };

  const content = (
    <>
      <span className="mini-frame-wrap" aria-label={`${card.id} ${card.name}`} role="img">
        <span className="mini-card-art" style={artStyle} aria-hidden="true" />
        <span className="mini-card-frame" style={frameStyle} aria-hidden="true" />
        {finalAttack !== null && (
          <>
            <span className="mini-stat mini-atk"><StatNumber value={finalAttack} label="ATK" /></span>
            <span className="mini-stat mini-def"><StatNumber value={finalDefense ?? 0} label="DEF" /></span>
          </>
        )}
      </span>
      {showTooltip && (
        <span className="detail-relation-tooltip">
          {card.name}
          {current && <small>CARTA ATUAL</small>}
          {armed && !opening && <small>CLIQUE PARA ABRIR</small>}
          {opening && <small>CARREGANDO...</small>}
        </span>
      )}
    </>
  );

  if (!onActivate || !selectionKey) {
    return <span className="detail-relation-card">{content}</span>;
  }

  return (
    <button
      type="button"
      className={`detail-relation-card detail-relation-card--interactive${armed ? " is-armed" : ""}${opening ? " is-opening" : ""}${current ? " is-current" : ""}`}
      aria-label={current
        ? `${card.name}, carta atual`
        : armed
          ? `${card.name} selecionada. Clique para abrir.`
          : `Selecionar ${card.name}`}
      aria-pressed={armed}
      aria-disabled={current || opening}
      onClick={() => !current && !opening && onActivate(card, selectionKey)}
    >
      {content}
    </button>
  );
}

function RelationGrid({
  relations,
  className = "",
  focusCardId,
  armedRelationKey,
  openingRelationKey,
  onActivateCard,
}: {
  relations: Relation[];
  className?: string;
  focusCardId: string;
  armedRelationKey: string | null;
  openingRelationKey: string | null;
  onActivateCard: (card: Card, selectionKey: string) => void;
}) {
  const relationCard = (
    relation: Relation,
    position: "left" | "right" | "result",
    props: { attack?: number; defense?: number } = {},
  ) => {
    const card = relation[position];
    const selectionKey = `${relation.key}:${position}:${card.id}`;
    return (
      <RelationMiniCard
        card={card}
        {...props}
        selectionKey={selectionKey}
        armed={armedRelationKey === selectionKey}
        opening={openingRelationKey === selectionKey}
        current={card.id === focusCardId}
        onActivate={onActivateCard}
      />
    );
  };

  return (
    <div className={`detail-relation-grid${className ? ` ${className}` : ""}`}>
      {relations.map((relation) => (
        <article className="detail-equation" key={relation.key}>
          {relationCard(relation, "left")}
          <span className="detail-operator">+</span>
          {relationCard(relation, "right")}
          <span className="detail-operator">=</span>
          {relationCard(relation, "result", {
            attack: relation.boost ? (relation.result.attack ?? 0) + relation.boost : undefined,
            defense: relation.boost ? (relation.result.defense ?? 0) + relation.boost : undefined,
          })}
        </article>
      ))}
    </div>
  );
}

function GameCardGlyph({ className = "" }: { className?: string }) {
  return <span className={`detail-game-card-glyph ${className}`} aria-hidden="true" />;
}

function FusionStarIcon() {
  return (
    <svg className="detail-fusion-star" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="fusion-star-gradient" x1="8" y1="5" x2="31" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f32636" />
          <stop offset="1" stopColor="#21dce8" />
        </linearGradient>
      </defs>
      <path
        d={FUSION_STAR_PATH}
        fill="#02050b"
        stroke="#02050b"
        strokeWidth="4.5"
        strokeLinejoin="round"
      />
      <path
        d={FUSION_STAR_PATH}
        fill="url(#fusion-star-gradient)"
        stroke="url(#fusion-star-gradient)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FusionIcon() {
  return (
    <span className="detail-fusion-icon" aria-hidden="true">
      <GameCardGlyph />
      <FusionStarIcon />
      <GameCardGlyph />
    </span>
  );
}

function EquipIcon() {
  return (
    <span className="detail-equip-icon" aria-hidden="true">
      <img src="/game-assets/categories/equip-icon.png" alt="" />
    </span>
  );
}

function ModeIcon({ mode }: { mode: RelationMode }) {
  if (mode === "equips") return <EquipIcon />;
  if (mode === "fusions") return <FusionIcon />;
  return (
    <span className={`detail-mode-glyph detail-mode-glyph--${mode}`} aria-hidden="true">
      <GameCardGlyph />
      <GameCardGlyph />
    </span>
  );
}

function GuardianSprite({ name, size = 38 }: { name: GuardianName; size?: number }) {
  const main = GUARDIAN_SPRITES[name];
  if (!main) {
    return (
      <span
        className="detail-guardian-sprite detail-guardian-symbol"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.82) }}
        aria-hidden="true"
      >
        {GUARDIAN_SYMBOLS[name]}
      </span>
    );
  }
  const scale = size / 16;
  const style: CSSProperties = {
    width: size,
    height: size,
    backgroundImage: 'url("/game-assets/fusion/main.png")',
    backgroundRepeat: "no-repeat",
    backgroundSize: `${191 * scale}px ${203 * scale}px`,
    backgroundPosition: `${-main.x * scale}px ${-main.y * scale}px`,
  };
  return <span className="detail-guardian-sprite" style={style} aria-hidden="true" />;
}

function GuardianRelationTooltip({
  name,
  strongAgainst,
  weakAgainst,
}: {
  name: GuardianName;
  strongAgainst: GuardianName;
  weakAgainst: GuardianName;
}) {
  return (
    <span className="detail-guardian-tooltip" role="tooltip">
      <span className="detail-guardian-tooltip-title">RELAÇÃO DA ESCOLHA</span>
      <span className="detail-guardian-tooltip-line strong">
        <GuardianSprite name={name} size={24} />
        <b>→</b>
        <GuardianSprite name={strongAgainst} size={24} />
        <em>FORTE CONTRA</em>
      </span>
      <span className="detail-guardian-tooltip-line weak">
        <GuardianSprite name={weakAgainst} size={24} />
        <b>→</b>
        <GuardianSprite name={name} size={24} />
        <em>FRACO CONTRA</em>
      </span>
    </span>
  );
}

function availability(card: Card) {
  if (!card.cost || card.cost >= 999999) return 0.08;
  return Math.max(0.12, 1 - Math.log10(card.cost + 10) / 6);
}

function relationScore(mode: RelationMode, left: Card, right: Card, result: Card, boost = 0) {
  if (mode === "recipes") {
    return (availability(left) + availability(right)) * 1000 - Math.max(left.attack ?? 0, right.attack ?? 0) / 5;
  }
  if (mode === "fusions") {
    return availability(right) * 900 + (result.attack ?? 0) / 4;
  }
  return availability(right) * 700 + boost;
}

function buildRelations(mode: RelationMode, detailData: DetailData, focusCard: Card): Relation[] {
  if (mode === "recipes") {
    return detailData.recipes.flatMap(({ left: leftId, right: rightId }) => {
      const left = cardById.get(leftId);
      const right = cardById.get(rightId);
      if (!left || !right) return [];
      const types = Array.from(new Set([left.type, right.type]));
      return [{
        key: `recipe-${left.id}-${right.id}`,
        left,
        right,
        result: focusCard,
        relevantType: null,
        types,
        score: relationScore(mode, left, right, focusCard),
      }];
    });
  }

  if (mode === "fusions") {
    return detailData.fusions.flatMap(({ partner: partnerId, result: resultId }) => {
      const partner = cardById.get(partnerId);
      const result = cardById.get(resultId);
      if (!partner || !result) return [];
      return [{
        key: `fusion-${partner.id}-${result.id}`,
        left: focusCard,
        right: partner,
        result,
        relevantType: partner.type,
        types: [partner.type],
        score: relationScore(mode, focusCard, partner, result),
      }];
    });
  }

  return detailData.equips.flatMap(({ partner: partnerId, result: resultId, boost }) => {
    const partner = cardById.get(partnerId);
    const result = cardById.get(resultId);
    if (!partner || !result) return [];
    return [{
      key: `equip-${partner.id}-${result.id}`,
      left: focusCard.cardType === "Equip" ? partner : focusCard,
      right: focusCard.cardType === "Equip" ? focusCard : partner,
      result,
      relevantType: partner.cardType === "Monster" ? partner.type : null,
      types: partner.cardType === "Monster" ? [partner.type] : [],
      boost,
      score: relationScore(mode, focusCard, partner, result, boost),
    }];
  });
}

function DetailRow({
  icon,
  label,
  children,
  wide = false,
  className = "",
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  wide?: boolean;
  className?: string;
}) {
  return (
    <div className={`detail-meta-row${wide ? " detail-meta-row--wide" : ""}${className ? ` ${className}` : ""}`}>
      <span className="detail-meta-icon">{icon}</span>
      <span className="detail-meta-label">{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

function FavoriteButton({
  active,
  placement,
  onToggle,
}: {
  active: boolean;
  placement: "desktop" | "mobile";
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`detail-favorite-button detail-favorite-button--${placement}${active ? " is-active" : ""}`}
      aria-pressed={active}
      aria-label={active ? "Remover carta da My List" : "Adicionar carta à My List"}
      onClick={onToggle}
    >
      <span className="pixel-heart" aria-hidden="true" />
      <span>{active ? "ADICIONADO À MY LIST" : "ADICIONAR À MY LIST"}</span>
      <small>{active ? "SALVO NESTE DISPOSITIVO" : "GUARDAR COMO FAVORITO"}</small>
    </button>
  );
}

function FieldDetailCard({
  placement,
  detailData,
  fieldCard,
}: {
  placement: "desktop" | "mobile";
  detailData: DetailData;
  fieldCard: Card;
}) {
  const field = detailData.field;
  if (!field) return null;
  return (
    <div
      className={`detail-field-card detail-field-card--${placement}`}
      tabIndex={0}
      aria-label={`Field ${field.name}; carta de campo ${fieldCard.name}`}
    >
      <span>FIELD</span>
      <strong>{field.name}</strong>
      <FieldSpriteIcon card={fieldCard} />
      <div className="detail-field-tooltip" role="tooltip">
        <RelationMiniCard card={fieldCard} showTooltip={false} />
        <div>
          <small>CARD DE CAMPO</small>
          <strong>{fieldCard.id} · {fieldCard.name}</strong>
          <span>Representação em mini-card do Field {field.name}.</span>
        </div>
      </div>
    </div>
  );
}

function GuardianDetailCard({
  placement,
  detailData,
}: {
  placement: "desktop" | "mobile";
  detailData: DetailData;
}) {
  return (
    <div className={`detail-guardian-card detail-guardian-card--${placement}`}>
      <span>GUARDIAN STAR</span>
      <div className="detail-guardian-list">
        {detailData.guardianStars.map((name) => {
          const { strongAgainst, weakAgainst } = GUARDIAN_RELATIONS[name];
          return (
            <div
              className="detail-guardian"
              key={`${placement}-${name}`}
              tabIndex={0}
              aria-label={`${name}: forte contra ${strongAgainst}; fraco contra ${weakAgainst}`}
            >
              <div className="detail-guardian-choice">
                <GuardianSprite name={name} size={placement === "mobile" ? 30 : 36} />
                <div><small>ESCOLHA</small><strong>{name}</strong></div>
              </div>
              <div className="detail-guardian-relations">
                <small className="strong"><span className="detail-guardian-triangle" aria-label="Forte">▲</span><GuardianSprite name={strongAgainst} size={placement === "mobile" ? 16 : 18} /></small>
                <small className="weak"><span className="detail-guardian-triangle" aria-label="Fraco">▼</span><GuardianSprite name={weakAgainst} size={placement === "mobile" ? 16 : 18} /></small>
              </div>
              <GuardianRelationTooltip name={name} strongAgainst={strongAgainst} weakAgainst={weakAgainst} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FieldUnavailableCard({ placement }: { placement: "desktop" | "mobile" }) {
  return (
    <div className={`detail-field-card detail-field-card--${placement} detail-field-card--unavailable`}>
      <span>FIELD</span>
      <strong>SEM AFINIDADE</strong>
      <div className="detail-field-none-glyph" aria-hidden="true">∅</div>
      <small>REPTILE NÃO RECEBE BÔNUS DE TERRENO</small>
    </div>
  );
}

function NonMonsterSideData({ placement, cardType }: { placement: "desktop" | "mobile"; cardType: string }) {
  return (
    <div className={`detail-non-monster-data detail-non-monster-data--${placement}`}>
      <img src={CARD_TYPE_ICONS[cardType] ?? CARD_TYPE_ICONS.Magic} alt="" aria-hidden="true" />
      <span>CLASSE DA CARTA</span>
      <strong>{cardType.toUpperCase()}</strong>
      <small>FIELD E GUARDIAN STAR NÃO SE APLICAM</small>
    </div>
  );
}

export default function CardDetailOverlay({
  detailData,
  open,
  onClose,
  isFavorite,
  onToggleFavorite,
  onPrevious,
  onNext,
  onPrefetchRelated,
  onOpenRelated,
  returnTarget,
  onReturn,
}: Props) {
  const cardId = detailData.cardId;
  const focusCard = cardById.get(detailData.cardId) as Card;
  const fieldCard = detailData.field ? cardById.get(detailData.field.cardId) ?? null : null;
  const fieldBackground = detailData.field
    ? FIELD_BACKGROUND_BY_NAME[detailData.field.name] ?? DEFAULT_FIELD_BACKGROUND
    : DEFAULT_FIELD_BACKGROUND;
  const initialMode: RelationMode = detailData.counts.recipes > 0
    ? "recipes"
    : detailData.counts.fusions > 0
      ? "fusions"
      : detailData.counts.equips > 0
        ? "equips"
        : "recipes";
  const [mode, setMode] = useState<RelationMode>(initialMode);
  const [activeType, setActiveType] = useState("TOP");
  const [query, setQuery] = useState("");
  const [maxAttack, setMaxAttack] = useState("");
  const [resultPage, setResultPage] = useState(0);
  const [isMobileDetail, setIsMobileDetail] = useState(false);
  const [stateCardId, setStateCardId] = useState(cardId);
  const [armedRelationKey, setArmedRelationKey] = useState<string | null>(null);
  const [openingRelationKey, setOpeningRelationKey] = useState<string | null>(null);
  const [isReturning, setIsReturning] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wheelLockedRef = useRef(false);
  const wheelUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (stateCardId !== cardId) {
    setStateCardId(cardId);
    setMode(initialMode);
    setActiveType("TOP");
    setQuery("");
    setMaxAttack("");
    setResultPage(0);
    setArmedRelationKey(null);
    setOpeningRelationKey(null);
  }

  const activateRelationCard = async (card: Card, selectionKey: string) => {
    if (card.id === focusCard.id || openingRelationKey) return;
    if (armedRelationKey !== selectionKey) {
      setArmedRelationKey(selectionKey);
      onPrefetchRelated?.(card.id);
      return;
    }
    if (!onOpenRelated) return;
    setOpeningRelationKey(selectionKey);
    const opened = await onOpenRelated(card.id);
    setOpeningRelationKey(null);
    if (opened) setArmedRelationKey(null);
  };

  const returnToRelationOrigin = async () => {
    if (!onReturn || isReturning) return;
    setIsReturning(true);
    const returned = await onReturn();
    setIsReturning(false);
    if (returned) setArmedRelationKey(null);
  };

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && onPrevious) onPrevious();
      if (event.key === "ArrowRight" && onNext) onNext();
    };
    document.addEventListener("keydown", onKeyDown);
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      if (wheelUnlockTimerRef.current) clearTimeout(wheelUnlockTimerRef.current);
      wheelUnlockTimerRef.current = null;
      wheelLockedRef.current = false;
      previousFocus?.focus?.();
    };
  }, [onClose, onNext, onPrevious, open]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 560px)");
    const updateMobileState = () => setIsMobileDetail(mediaQuery.matches);
    updateMobileState();
    mediaQuery.addEventListener("change", updateMobileState);
    return () => mediaQuery.removeEventListener("change", updateMobileState);
  }, []);

  const allRelations = useMemo(
    () => buildRelations(mode, detailData, focusCard),
    [detailData, focusCard, mode],
  );
  const relationAttackFloor = useMemo(() => {
    if (mode === "equips") return 0;
    const floors = allRelations.map((relation) => mode === "recipes"
      ? Math.max(relation.left.attack ?? 0, relation.right.attack ?? 0)
      : relation.right.attack ?? 0);
    const floor = Math.min(...floors);
    return Number.isFinite(floor) ? floor : 0;
  }, [allRelations, mode]);
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const relation of allRelations) {
      for (const type of relation.types) counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return counts;
  }, [allRelations]);

  const orderedTypes = useMemo(
    () => [...relationTypes].sort((first, second) => {
      const difference = (typeCounts.get(second) ?? 0) - (typeCounts.get(first) ?? 0);
      return difference || first.localeCompare(second);
    }),
    [typeCounts],
  );

  const filteredRelations = useMemo(() => {
    const term = normalize(query.trim());
    const attackLimit = mode === "equips" || !maxAttack
      ? null
      : Math.max(relationAttackFloor, Number(maxAttack));
    return allRelations
      .filter((relation) => {
        if (activeType !== "TOP" && !relation.types.includes(activeType)) return false;
        if (attackLimit !== null && Number.isFinite(attackLimit)) {
          const candidates = mode === "recipes" ? [relation.left, relation.right] : [relation.right];
          if (candidates.some((card) => (card.attack ?? Number.POSITIVE_INFINITY) > attackLimit)) return false;
        }
        if (!term) return true;
        return [relation.left, relation.right, relation.result].some((card) =>
          normalize(`${card.id} ${card.name} ${card.password ?? ""}`).includes(term),
        );
      })
      .sort((first, second) => activeType === "TOP" ? second.score - first.score : Number(first.left.id) - Number(second.left.id));
  }, [activeType, allRelations, maxAttack, mode, query, relationAttackFloor]);

  const relationsPerPage = isMobileDetail ? 4 : RELATIONS_PER_PAGE;
  const pageCount = activeType === "TOP"
    ? 1
    : Math.max(1, Math.ceil(filteredRelations.length / relationsPerPage));
  const currentResultPage = Math.min(resultPage, pageCount - 1);
  const relationsForPage = (page: number) => activeType === "TOP"
    ? filteredRelations.slice(0, relationsPerPage)
    : filteredRelations.slice(page * relationsPerPage, (page + 1) * relationsPerPage);
  const displayedRelations = relationsForPage(currentResultPage);
  const scrollbarThumbHeight = pageCount > 1 ? Math.max(10, 100 / pageCount) : 100;
  const scrollbarThumbTop = pageCount > 1
    ? (currentResultPage / (pageCount - 1)) * (100 - scrollbarThumbHeight)
    : 0;

  const changeResultPage = (nextPage: number) => {
    const clampedPage = Math.max(0, Math.min(nextPage, pageCount - 1));
    if (clampedPage !== currentResultPage) {
      setArmedRelationKey(null);
      setResultPage(clampedPage);
    }
  };

  const resetResultPagination = () => {
    setResultPage(0);
  };

  const handleResultsWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (activeType === "TOP" || pageCount <= 1 || Math.abs(event.deltaY) < 4) return;
    event.preventDefault();

    if (wheelUnlockTimerRef.current) clearTimeout(wheelUnlockTimerRef.current);
    wheelUnlockTimerRef.current = setTimeout(() => {
      wheelLockedRef.current = false;
      wheelUnlockTimerRef.current = null;
    }, 220);

    if (wheelLockedRef.current) return;
    wheelLockedRef.current = true;
    changeResultPage(currentResultPage + (event.deltaY > 0 ? 1 : -1));
  };

  const handleScrollbarClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (pageCount <= 1) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    changeResultPage(Math.round(ratio * (pageCount - 1)));
  };

  const handleScrollbarKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (pageCount <= 1) return;
    if (["ArrowDown", "PageDown"].includes(event.key)) {
      event.preventDefault();
      changeResultPage(currentResultPage + 1);
    } else if (["ArrowUp", "PageUp"].includes(event.key)) {
      event.preventDefault();
      changeResultPage(currentResultPage - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      changeResultPage(0);
    } else if (event.key === "End") {
      event.preventDefault();
      changeResultPage(pageCount - 1);
    }
  };

  const selectMode = (nextMode: RelationMode) => {
    const typeIsAvailable = activeType === "TOP"
      || buildRelations(nextMode, detailData, focusCard).some((relation) => relation.types.includes(activeType));
    setMode(nextMode);
    setArmedRelationKey(null);
    setActiveType(typeIsAvailable ? activeType : "TOP");
    resetResultPagination();
  };

  const selectType = (nextType: string) => {
    setArmedRelationKey(null);
    setActiveType(nextType);
    resetResultPagination();
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="detail-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        className="card-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          if (!target.closest(".detail-relation-card")) setArmedRelationKey(null);
        }}
      >
        <button ref={closeRef} type="button" className="detail-close" onClick={onClose} aria-label="Fechar detalhes">×</button>
        {onReturn && returnTarget && (
          <button
            type="button"
            className={`detail-return${isReturning ? " is-loading" : ""}`}
            onClick={() => void returnToRelationOrigin()}
            disabled={isReturning}
            aria-label={`Voltar para ${returnTarget.name}`}
            title={`Voltar para ${returnTarget.name}`}
          >
            <span aria-hidden="true">&#x21B6;</span>
          </button>
        )}
        <button
          type="button"
          className="detail-card-navigation detail-card-navigation--overlay detail-card-navigation--previous"
          onClick={onPrevious}
          disabled={!onPrevious}
          aria-label="Visualizar carta anterior"
          title={onPrevious ? "Carta anterior" : "Carta anterior indisponível neste modelo"}
        />
        <button
          type="button"
          className="detail-card-navigation detail-card-navigation--overlay detail-card-navigation--next"
          onClick={onNext}
          disabled={!onNext}
          aria-label="Visualizar próxima carta"
          title={onNext ? "Próxima carta" : "Próxima carta indisponível neste modelo"}
        />

        <div className="detail-upper">
          <div className="detail-panel-label">DETALHES</div>
          <article className="detail-info-panel">
            <div className="detail-mobile-card-heading" aria-hidden="true">
              <span className="detail-card-number">{focusCard.id}</span>
              <span className="detail-mobile-card-title">
                <CardClassificationIcon card={focusCard} size={24} />
                <strong>{focusCard.name}</strong>
              </span>
            </div>

            <div className="detail-card-column">
              <div className="detail-card-image-wrap">
                <div className="detail-card-image-stage">
                  <img src={`/cards/${focusCard.id}.webp`} alt={`Card completa ${focusCard.name}`} />
                </div>
              </div>
            </div>

            <div className="detail-copy-column">
              <div className="detail-copy">
                <span className="detail-card-number">{focusCard.id}</span>
                <h2 id="card-detail-title"><CardClassificationIcon card={focusCard} size={27} />{focusCard.name}</h2>
                <div className="detail-meta-grid">
                  <DetailRow icon={<FusionIcon />} label="FUSIONS">{detailData.counts.fusions}</DetailRow>
                  <DetailRow icon={<EquipIcon />} label="EQUIPS">{detailData.counts.equips}</DetailRow>
                  <DetailRow icon={<img src="/game-assets/icon_password.png" alt="" />} label="PASSWORD">{focusCard.password}</DetailRow>
                  <DetailRow icon={<img src="/game-assets/icon_starchip.png" alt="" />} label="PRICE">{formatter.format(focusCard.cost ?? 0)}</DetailRow>
                  <DetailRow
                    icon={<img src="/game-assets/description-monster-icon.png" alt="" />}
                    label="DESCRIPTION"
                    wide
                    className="detail-description-row--desktop"
                  >
                    {detailData.description}
                  </DetailRow>
                </div>
                <FavoriteButton
                  active={isFavorite}
                  placement="desktop"
                  onToggle={onToggleFavorite}
                />
              </div>
            </div>

            {focusCard.cardType === "Monster" ? (
              <>
                {fieldCard
                  ? <FieldDetailCard placement="mobile" detailData={detailData} fieldCard={fieldCard} />
                  : <FieldUnavailableCard placement="mobile" />}
                <GuardianDetailCard placement="mobile" detailData={detailData} />
              </>
            ) : (
              <NonMonsterSideData placement="mobile" cardType={focusCard.cardType} />
            )}
            <div className="detail-mobile-description">
              <DetailRow
                icon={<img src="/game-assets/description-monster-icon.png" alt="" />}
                label="DESCRIPTION"
                wide
              >
                {detailData.description}
              </DetailRow>
            </div>
            <FavoriteButton
              active={isFavorite}
              placement="mobile"
              onToggle={onToggleFavorite}
            />

            <aside className="detail-side-data">
              {focusCard.cardType === "Monster" ? (
                <>
                  {fieldCard
                    ? <FieldDetailCard placement="desktop" detailData={detailData} fieldCard={fieldCard} />
                    : <FieldUnavailableCard placement="desktop" />}
                  <GuardianDetailCard placement="desktop" detailData={detailData} />
                </>
              ) : (
                <NonMonsterSideData placement="desktop" cardType={focusCard.cardType} />
              )}
            </aside>
          </article>

          <div className="detail-video-stage">
            <div className="detail-video-label">IN-GAME</div>
            <div
              className="detail-video-panel"
              data-field={detailData.field?.name ?? "NONE"}
              style={{ "--detail-field-background": `url("${fieldBackground}")` } as CSSProperties}
            >
              {detailData.inGameMedia.kind === "model-video" ? (
                <video
                  key={focusCard.id}
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  style={{ objectPosition: detailData.inGameMedia.objectPosition }}
                  aria-label={`Modelo 3D in-game de ${focusCard.name}`}
                >
                  <source src={detailData.inGameMedia.localPath} type="video/webm" />
                </video>
              ) : (
                <img
                  className="detail-fallback-media"
                  src={detailData.inGameMedia.localPath}
                  style={{ objectPosition: detailData.inGameMedia.objectPosition }}
                  alt={`Visual temporário in-game de ${focusCard.name}`}
                />
              )}
              <span className="detail-video-vignette" />
              <button
                type="button"
                className="detail-card-navigation detail-card-navigation--video detail-card-navigation--previous"
                onClick={onPrevious}
                disabled={!onPrevious}
                aria-label="Visualizar carta anterior"
                title={onPrevious ? "Carta anterior" : "Carta anterior indisponível neste modelo"}
              />
              <button
                type="button"
                className="detail-card-navigation detail-card-navigation--video detail-card-navigation--next"
                onClick={onNext}
                disabled={!onNext}
                aria-label="Visualizar próxima carta"
                title={onNext ? "Próxima carta" : "Próxima carta indisponível neste modelo"}
              />
            </div>
          </div>
        </div>

        <div className="detail-relations">
          <div className="detail-relation-toolbar">
            <div className="detail-relation-primary">
              <div className="detail-type-rail" aria-label="Filtrar relações por tipo de monstro">
                <button type="button" className={activeType === "TOP" ? "active" : ""} onClick={() => selectType("TOP")} aria-pressed={activeType === "TOP"}>TOP</button>
                {orderedTypes.map((type) => {
                  const count = typeCounts.get(type) ?? 0;
                  return (
                    <button
                      type="button"
                      key={type}
                      className={activeType === type ? "active" : ""}
                      onClick={() => count > 0 && selectType(type)}
                      disabled={count === 0}
                      title={count > 0 ? type : `${type}: indisponível neste modo`}
                      aria-label={type}
                      aria-pressed={activeType === type}
                    >
                      <TypeSpriteIcon type={type} size={22} />
                    </button>
                  );
                })}
                <span
                  className="detail-total-box"
                  tabIndex={0}
                  aria-label={`${formatter.format(filteredRelations.length)} possibilidades`}
                >
                  <strong>{formatter.format(filteredRelations.length)}</strong>
                  <span className="detail-total-tooltip" role="tooltip">Total de possibilidades</span>
                </span>
              </div>

              <div className="detail-mode-tabs" role="tablist" aria-label="Tipo de relação">
                {(["recipes", "fusions", "equips"] as RelationMode[]).map((relationMode) => {
                  const available = detailData.counts[relationMode] > 0;
                  return (
                    <button
                      type="button"
                      role="tab"
                      key={relationMode}
                      className={mode === relationMode ? "active" : ""}
                      disabled={!available}
                      aria-selected={mode === relationMode}
                      onClick={() => available && selectMode(relationMode)}
                    >
                      <ModeIcon mode={relationMode} />
                      {relationMode.toUpperCase()}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="detail-relation-filters">
              <label className={`detail-atk-filter${mode === "equips" ? " disabled" : ""}`}>
                <img src="/game-assets/atk-filter-icon.png" alt="" aria-hidden="true" />
                <input
                  type="number"
                  min={relationAttackFloor}
                  max="9999"
                  step="50"
                  value={maxAttack}
                  onChange={(event) => {
                    setArmedRelationKey(null);
                    setMaxAttack(event.target.value);
                    resetResultPagination();
                  }}
                  onBlur={(event) => {
                    if (event.target.value && Number(event.target.value) < relationAttackFloor) {
                      setMaxAttack(String(relationAttackFloor));
                    }
                  }}
                  placeholder="ATK máx."
                  aria-label="ATK máximo dos componentes"
                  disabled={mode === "equips"}
                />
                <span className="detail-atk-hint">mín. <b>{formatter.format(relationAttackFloor)}</b></span>
              </label>
              <label>
                <span className="detail-search-icon" aria-hidden="true">⌕</span>
                <input
                  value={query}
                  onChange={(event) => {
                    setArmedRelationKey(null);
                    setQuery(event.target.value);
                    resetResultPagination();
                  }}
                  placeholder="Nome, nº ou Password"
                  aria-label="Pesquisar nas relações"
                />
              </label>
            </div>
          </div>

          <div className="detail-results-frame">
            <div className="detail-result-guides" aria-hidden="true"><i /><i /><i /></div>
            <div className={`detail-page-caret${pageCount <= 1 ? " disabled" : ""}`} role="group" aria-label={`Paginação em grupos de ${relationsPerPage}`}>
              <button
                type="button"
                className="detail-caret-button detail-caret-button--up"
                aria-label={`Mostrar os ${relationsPerPage} resultados anteriores`}
                disabled={pageCount <= 1 || currentResultPage === 0}
                onClick={() => changeResultPage(currentResultPage - 1)}
              />
              <i aria-hidden="true" />
              <button
                type="button"
                className="detail-caret-button detail-caret-button--down"
                aria-label={`Mostrar os próximos ${relationsPerPage} resultados`}
                disabled={pageCount <= 1 || currentResultPage >= pageCount - 1}
                onClick={() => changeResultPage(currentResultPage + 1)}
              />
            </div>
            <span
              className="detail-page-counter"
              aria-label={`Página ${currentResultPage + 1} de ${pageCount}`}
              aria-live="polite"
            >
              {currentResultPage + 1}/{pageCount}
            </span>
            <div
              id="detail-relation-results"
              className="detail-relation-scroll"
              onWheel={handleResultsWheel}
            >
              {displayedRelations.length > 0 ? (
                <div className="detail-relation-stack">
                  <RelationGrid
                    relations={displayedRelations}
                    className="detail-relation-grid--current"
                    focusCardId={focusCard.id}
                    armedRelationKey={armedRelationKey}
                    openingRelationKey={openingRelationKey}
                    onActivateCard={(card, selectionKey) => void activateRelationCard(card, selectionKey)}
                    key={`${mode}-${activeType}-${currentResultPage}-current`}
                  />
                </div>
              ) : (
                <div className="detail-empty-relations"><span>◇</span><strong>NENHUMA COMBINAÇÃO</strong><small>Ajuste o tipo, ATK ou a busca.</small></div>
              )}
            </div>
            <div className={`detail-page-navigation${pageCount <= 1 ? " disabled" : ""}`}>
              <button
                type="button"
                className="detail-scroll-step detail-scroll-step--up"
                aria-label={`Subir ${relationsPerPage} resultados`}
                disabled={pageCount <= 1 || currentResultPage === 0}
                onClick={() => changeResultPage(currentResultPage - 1)}
              />
              <div
                className="detail-page-scrollbar"
                role="scrollbar"
                tabIndex={pageCount > 1 ? 0 : -1}
                aria-label={`Navegar pelos resultados em grupos de ${relationsPerPage}`}
                aria-controls="detail-relation-results"
                aria-valuemin={1}
                aria-valuemax={pageCount}
                aria-valuenow={currentResultPage + 1}
                onClick={handleScrollbarClick}
                onKeyDown={handleScrollbarKeyDown}
              >
                <span style={{ height: `${scrollbarThumbHeight}%`, top: `${scrollbarThumbTop}%` }} />
              </div>
              <button
                type="button"
                className="detail-scroll-step detail-scroll-step--down"
                aria-label={`Descer ${relationsPerPage} resultados`}
                disabled={pageCount <= 1 || currentResultPage >= pageCount - 1}
                onClick={() => changeResultPage(currentResultPage + 1)}
              />
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
