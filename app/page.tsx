"use client";

import type { CSSProperties } from "react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import CardDetailOverlay from "./components/CardDetailOverlay";
import archiveData from "./data/cards.json";
import detailManifestData from "./data/card-details-manifest.json";
import spriteData from "./data/minicard-sprite-map.json";
import type { CardDetailData, CardDetailManifest } from "./types/card-detail";

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

type SpriteRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  column: number;
  row: number;
};

type TypeSprite = { x: number; y: number; width: number; height: number };
type DigitSprite = { x: number; y: number; width: number; height: number };
type SortMode = "number" | "name" | "cost-low" | "cost-high";
type LibraryTab = "card-book" | "my-list";
type DetailView = { card: Card; data: CardDetailData };
type FieldAdvantage = "all" | "FOREST" | "WASTELAND" | "MOUNTAIN" | "SOGEN" | "UMI" | "YAMI";

const cards = archiveData.cards as Card[];
const fusionSprites = spriteData.fusionMinicards.cards as Record<string, SpriteRect>;
const typeSprites = spriteData.main.typeIcons as Record<string, TypeSprite>;
const statDigitSprites = spriteData.main.statDigits as Record<string, DigitSprite>;
const framePositions = spriteData.frames.runtimePreset.positions as Record<
  string,
  { x: number; y: number }
>;

const numberFormatter = new Intl.NumberFormat("pt-BR");
const primaryFilters: Array<{ value: string; label: string; glyph?: string; icon?: string }> = [
  { value: "all", label: "Todos", glyph: "∞" },
  { value: "Monster", label: "Monstros", icon: "/game-assets/categories/monsters-icon.png" },
  { value: "Magic", label: "Magias", icon: "/game-assets/categories/magic-icon.png" },
  { value: "Trap", label: "Armadilhas", icon: "/game-assets/categories/trap-icon.png" },
  { value: "Equip", label: "Equipamentos", icon: "/game-assets/categories/equip-icon.png" },
  { value: "Field", label: "Campos", icon: "/game-assets/categories/campo-icon.png" },
  { value: "Ritual", label: "Rituais", icon: "/game-assets/categories/ritual-icon.png" },
];

const cardBookCategoryIconOverrides: Record<string, string> = {
  Field: "/game-assets/categories/magic-icon.png",
  Ritual: "/game-assets/categories/ritual-fusion-icon.png",
};

const fieldAdvantageFilters: Array<{
  value: Exclude<FieldAdvantage, "all">;
  label: string;
  fieldCardId: string;
}> = [
  { value: "FOREST", label: "Forest", fieldCardId: "330" },
  { value: "WASTELAND", label: "Wasteland", fieldCardId: "331" },
  { value: "MOUNTAIN", label: "Mountain", fieldCardId: "332" },
  { value: "SOGEN", label: "Sogen", fieldCardId: "333" },
  { value: "UMI", label: "Umi (Sea)", fieldCardId: "334" },
  { value: "YAMI", label: "Yami (Dark)", fieldCardId: "335" },
];

const MINI_CARD_SCALE = 1.1;
const STAT_SPRITE_SCALE = 1.54 * MINI_CARD_SCALE;
const MOBILE_CARD_PAGE_SIZE = 4;
const MY_LIST_STORAGE_KEY = "yfm-card-book:my-list:v1";
const detailManifest = detailManifestData as CardDetailManifest;
const detailCardIdSet = new Set(detailManifest.ids);
const detailCards = detailManifest.ids
  .map((id) => cards.find((card) => card.id === id))
  .filter((card): card is Card => Boolean(card));

const monsterTypes = Array.from(
  new Set(cards.filter((card) => card.cardType === "Monster").map((card) => card.type)),
).sort((a, b) => a.localeCompare(b));

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function formatCost(cost: number | null) {
  if (cost === null) return "—";
  if (cost === 0) return "N/D";
  return numberFormatter.format(cost);
}

function parseLimit(value: string) {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function TypeSpriteIcon({ type, size = 19 }: { type: string; size?: number }) {
  const sprite = typeSprites[type];
  if (!sprite) {
    return (
      <span className="type-fallback" style={{ width: size, height: size }} aria-hidden="true">
        {type.slice(0, 1)}
      </span>
    );
  }

  const scale = size / sprite.width;
  const style: CSSProperties = {
    width: size,
    height: size,
    backgroundImage: 'url("/game-assets/fusion/main.png")',
    backgroundRepeat: "no-repeat",
    backgroundSize: `${191 * scale}px ${203 * scale}px`,
    backgroundPosition: `${-sprite.x * scale}px ${-sprite.y * scale}px`,
  };

  return <span className="type-sprite" style={style} aria-hidden="true" />;
}

function CategoryIcon({ cardType, size = 21 }: { cardType: string; size?: number }) {
  const category = primaryFilters.find((filter) => filter.value === cardType);
  const icon = cardBookCategoryIconOverrides[cardType] ?? category?.icon;
  if (!icon) return null;

  return (
    <img
      className="category-image-icon"
      src={icon}
      alt=""
      width={size}
      height={size}
      aria-hidden="true"
    />
  );
}

function FieldFilterSprite({ cardId, size = 28 }: { cardId: string; size?: number }) {
  const sprite = fusionSprites[cardId];
  if (!sprite) return null;
  const style: CSSProperties = {
    width: size,
    height: size,
    backgroundImage: 'url("/game-assets/fusion/cards.webp")',
    backgroundRepeat: "no-repeat",
    backgroundSize: `${26 * size}px ${28 * size}px`,
    backgroundPosition: `${-sprite.column * size}px ${-sprite.row * size}px`,
  };
  return <span className="field-filter-sprite" style={style} aria-hidden="true" />;
}

function StatNumber({ value, label }: { value: number; label: string }) {
  const valueText = String(value);
  const hiddenCount = Math.max(0, 4 - valueText.length);
  const digits = `${"0".repeat(hiddenCount)}${valueText}`.split("");

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

function CardArtSprite({ card }: { card: Card }) {
  const art = fusionSprites[card.id];
  const frame = framePositions[card.cardType] ?? framePositions.Monster;
  const artStyle: CSSProperties = {
    backgroundImage: 'url("/game-assets/fusion/cards.webp")',
    backgroundPosition: `${-(art?.column ?? 0) * 62.54 * MINI_CARD_SCALE}px ${-(art?.row ?? 0) * 56.64 * MINI_CARD_SCALE}px`,
  };
  const frameStyle: CSSProperties = {
    backgroundImage: 'url("/game-assets/fusion/frames.webp")',
    backgroundPosition: `${frame.x * MINI_CARD_SCALE}px ${frame.y * MINI_CARD_SCALE}px`,
  };

  return (
    <span className="mini-frame-wrap" aria-label={`Miniatura de ${card.name}`} role="img">
      <span className="mini-card-art" style={artStyle} aria-hidden="true" />
      <span className="mini-card-frame" style={frameStyle} aria-hidden="true" />
      {card.attack !== null && (
        <>
          <span className="mini-stat mini-atk"><StatNumber value={card.attack} label="ATK" /></span>
          <span className="mini-stat mini-def"><StatNumber value={card.defense ?? 0} label="DEF" /></span>
        </>
      )}
    </span>
  );
}

function StarChip({ size = 17 }: { size?: number }) {
  return (
    <img
      className="starchip-icon"
      src="/game-assets/icon_starchip.png"
      alt=""
      width={size}
      height={size}
      aria-hidden="true"
    />
  );
}

function MiniCard({ card, onOpen }: { card: Card; onOpen?: (card: Card) => void }) {
  const hasDetails = detailCardIdSet.has(card.id) && Boolean(onOpen);
  return (
    <article
      className={`mini-card${hasDetails ? " mini-card--interactive" : ""}`}
      data-card-id={card.id}
      data-card-type={card.cardType.toLowerCase()}
      data-testid={`card-${card.id}`}
      role={hasDetails ? "button" : undefined}
      tabIndex={hasDetails ? 0 : undefined}
      aria-label={hasDetails ? `Abrir detalhes de ${card.name}` : undefined}
      aria-haspopup={hasDetails ? "dialog" : undefined}
      onClick={hasDetails ? () => onOpen?.(card) : undefined}
      onKeyDown={hasDetails ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen?.(card);
        }
      } : undefined}
    >
      <CardArtSprite card={card} />

      <div className="mini-card-info">
        <div className="mini-card-heading">
          <span className="mini-card-number">{card.id}</span>
          <div className="mini-card-title-row" title={`${card.name} · ${card.type}`}>
            {card.cardType === "Monster" ? (
              <TypeSpriteIcon type={card.type} size={21} />
            ) : (
              <CategoryIcon cardType={card.cardType} size={21} />
            )}
            <h2 title={card.name}>{card.name}</h2>
          </div>
        </div>

        <div className="mini-data-line password-line">
          <img className="password-icon" src="/game-assets/icon_password.png" alt="" aria-hidden="true" />
          <strong>{card.password ?? "N/A"}</strong>
        </div>

        <div className="mini-data-line cost-line">
          <StarChip size={19} />
          <strong className={card.cost === 0 ? "unavailable" : ""}>{formatCost(card.cost)}</strong>
        </div>
      </div>
    </article>
  );
}

export default function Home() {
  const [activeLibraryTab, setActiveLibraryTab] = useState<LibraryTab>("card-book");
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [favoritesHydrated, setFavoritesHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [monsterType, setMonsterType] = useState("all");
  const [fieldAdvantage, setFieldAdvantage] = useState<FieldAdvantage>("all");
  const [sort, setSort] = useState<SortMode>("number");
  const [minAttack, setMinAttack] = useState("");
  const [maxAttack, setMaxAttack] = useState("");
  const [minDefense, setMinDefense] = useState("");
  const [maxDefense, setMaxDefense] = useState("");
  const [maxCost, setMaxCost] = useState("");
  const [detailView, setDetailView] = useState<DetailView | null>(null);
  const [detailHistory, setDetailHistory] = useState<Card[]>([]);
  const [detailLoadError, setDetailLoadError] = useState("");
  const [isMobileBook, setIsMobileBook] = useState(false);
  const [mobileCardPagination, setMobileCardPagination] = useState({ page: 0, filterKey: "" });
  const deferredQuery = useDeferredValue(query);
  const searchRef = useRef<HTMLInputElement>(null);
  const catalogRef = useRef<HTMLDivElement>(null);
  const detailCacheRef = useRef(new Map<string, CardDetailData>());
  const detailRequestRef = useRef(0);

  const favoriteIdSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const favoriteCards = useMemo(
    () => cards.filter((card) => favoriteIdSet.has(card.id)),
    [favoriteIdSet],
  );
  const catalogCards = activeLibraryTab === "my-list" ? favoriteCards : cards;

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    counts.set("all", catalogCards.length);
    for (const card of catalogCards) {
      counts.set(card.cardType, (counts.get(card.cardType) ?? 0) + 1);
    }
    return counts;
  }, [catalogCards]);

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of catalogCards) {
      if (card.cardType === "Monster") counts.set(card.type, (counts.get(card.type) ?? 0) + 1);
    }
    return counts;
  }, [catalogCards]);

  const fieldAdvantageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of catalogCards) {
      const field = detailManifest.cards[card.id]?.fieldGameName;
      if (field) counts.set(field, (counts.get(field) ?? 0) + 1);
    }
    return counts;
  }, [catalogCards]);

  const filteredCards = useMemo(() => {
    const term = normalize(deferredQuery.trim());
    const minimumAttack = parseLimit(minAttack);
    const maximumAttack = parseLimit(maxAttack);
    const minimumDefense = parseLimit(minDefense);
    const maximumDefense = parseLimit(maxDefense);
    const costLimit = parseLimit(maxCost);
    const result = catalogCards.filter((card) => {
      const matchesCategory = category === "all" || card.cardType === category;
      const matchesType = monsterType === "all" || card.type === monsterType;
      const matchesField = fieldAdvantage === "all" ||
        detailManifest.cards[card.id]?.fieldGameName === fieldAdvantage;
      const matchesAttackMinimum = minimumAttack === null ||
        (card.attack !== null && card.attack >= minimumAttack);
      const matchesAttackMaximum = maximumAttack === null ||
        (card.attack !== null && card.attack <= maximumAttack);
      const matchesDefenseMinimum = minimumDefense === null ||
        (card.defense !== null && card.defense >= minimumDefense);
      const matchesDefenseMaximum = maximumDefense === null ||
        (card.defense !== null && card.defense <= maximumDefense);
      const matchesCost =
        costLimit === null || (card.cost !== null && card.cost > 0 && card.cost <= costLimit);
      const haystack = normalize(
        `${card.id} ${card.name} ${card.password ?? ""} ${card.cardType} ${card.type} ${card.cost ?? ""}`,
      );
      return (
        matchesCategory &&
        matchesType &&
        matchesField &&
        matchesAttackMinimum &&
        matchesAttackMaximum &&
        matchesDefenseMinimum &&
        matchesDefenseMaximum &&
        matchesCost &&
        (!term || haystack.includes(term))
      );
    });

    return result.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "cost-low") return (a.cost ?? Number.MAX_SAFE_INTEGER) - (b.cost ?? Number.MAX_SAFE_INTEGER);
      if (sort === "cost-high") return (b.cost ?? -1) - (a.cost ?? -1);
      return Number(a.id) - Number(b.id);
    });
  }, [catalogCards, category, deferredQuery, fieldAdvantage, maxAttack, maxCost, maxDefense, minAttack, minDefense, monsterType, sort]);

  const mobileFilterKey = [activeLibraryTab, favoriteIds.join(","), category, deferredQuery, fieldAdvantage, minAttack, maxAttack, minDefense, maxDefense, maxCost, monsterType, sort].join("|");
  const mobileCardPageCount = Math.max(1, Math.ceil(filteredCards.length / MOBILE_CARD_PAGE_SIZE));
  const mobileCardPage = mobileCardPagination.filterKey === mobileFilterKey
    ? Math.min(mobileCardPagination.page, mobileCardPageCount - 1)
    : 0;
  const displayedCards = isMobileBook
    ? filteredCards.slice(
        mobileCardPage * MOBILE_CARD_PAGE_SIZE,
        (mobileCardPage + 1) * MOBILE_CARD_PAGE_SIZE,
      )
    : filteredCards;
  const detailNavigationCards = activeLibraryTab === "my-list"
    ? detailCards.filter((card) => favoriteIdSet.has(card.id))
    : detailCards;
  const detailCardIndex = detailView
    ? detailNavigationCards.findIndex((card) => card.id === detailView.card.id)
    : -1;
  const previousDetailCard = detailCardIndex > 0 ? detailNavigationCards[detailCardIndex - 1] : null;
  const nextDetailCard = detailCardIndex >= 0 && detailCardIndex < detailNavigationCards.length - 1
    ? detailNavigationCards[detailCardIndex + 1]
    : null;

  const loadDetailData = useCallback(async (card: Card) => {
    const cached = detailCacheRef.current.get(card.id);
    if (cached) return cached;
    const entry = detailManifest.cards[card.id];
    if (!entry) throw new Error(`Detalhes não publicados para o card ${card.id}.`);
    const response = await fetch(entry.path, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Falha ${response.status} ao carregar o card ${card.id}.`);
    const detailData = await response.json() as CardDetailData;
    if (detailData.schemaVersion !== 2 || detailData.cardId !== card.id) {
      throw new Error(`Payload inconsistente para o card ${card.id}.`);
    }
    detailCacheRef.current.set(card.id, detailData);
    return detailData;
  }, []);

  const showDetailCard = useCallback(async (card: Card): Promise<boolean> => {
    const requestId = ++detailRequestRef.current;
    setDetailLoadError("");
    try {
      const data = await loadDetailData(card);
      if (requestId !== detailRequestRef.current) return false;
      setDetailView({ card, data });
      const index = detailCards.findIndex((item) => item.id === card.id);
      for (const adjacent of [detailCards[index - 1], detailCards[index + 1]]) {
        if (adjacent) void loadDetailData(adjacent).catch(() => undefined);
      }
      return true;
    } catch (error) {
      if (requestId !== detailRequestRef.current) return false;
      setDetailLoadError(error instanceof Error ? error.message : "Não foi possível carregar os detalhes.");
      return false;
    }
  }, [loadDetailData]);

  const openDetailFromCatalog = useCallback((card: Card) => {
    setDetailHistory([]);
    void showDetailCard(card);
  }, [showDetailCard]);

  const prefetchRelatedCard = useCallback((cardId: string) => {
    const card = cards.find((item) => item.id === cardId);
    if (!card || !detailCardIdSet.has(card.id)) return;
    void loadDetailData(card).catch(() => undefined);
    const image = new Image();
    image.src = `/cards/${card.id}.webp`;
  }, [loadDetailData]);

  const openRelatedCard = useCallback(async (cardId: string): Promise<boolean> => {
    const origin = detailView?.card;
    const target = cards.find((card) => card.id === cardId);
    if (!origin || !target || target.id === origin.id || !detailCardIdSet.has(target.id)) return false;
    const opened = await showDetailCard(target);
    if (opened) setDetailHistory((history) => [...history, origin]);
    return opened;
  }, [detailView, showDetailCard]);

  const returnFromRelatedCard = useCallback(async (): Promise<boolean> => {
    const target = detailHistory.at(-1);
    if (!target) return false;
    const opened = await showDetailCard(target);
    if (opened) setDetailHistory((history) => history.slice(0, -1));
    return opened;
  }, [detailHistory, showDetailCard]);

  const closeDetail = useCallback(() => {
    detailRequestRef.current += 1;
    setDetailView(null);
    setDetailHistory([]);
    setDetailLoadError("");
  }, []);

  const toggleFavorite = useCallback((cardId: string) => {
    setFavoriteIds((current) => current.includes(cardId)
      ? current.filter((id) => id !== cardId)
      : [...current, cardId].sort((first, second) => Number(first) - Number(second)));
  }, []);

  useEffect(() => {
    const loadFavorites = () => {
      try {
        const stored = window.localStorage.getItem(MY_LIST_STORAGE_KEY);
        const parsed = stored ? JSON.parse(stored) as { version?: number; cardIds?: unknown } : null;
        const validIds = Array.isArray(parsed?.cardIds)
          ? parsed.cardIds.filter((id): id is string =>
              typeof id === "string" && cards.some((card) => card.id === id))
          : [];
        setFavoriteIds([...new Set(validIds)].sort((first, second) => Number(first) - Number(second)));
      } catch {
        setFavoriteIds([]);
      } finally {
        setFavoritesHydrated(true);
      }
    };

    loadFavorites();
    const syncFavorites = (event: StorageEvent) => {
      if (event.key === MY_LIST_STORAGE_KEY) loadFavorites();
    };
    window.addEventListener("storage", syncFavorites);
    return () => window.removeEventListener("storage", syncFavorites);
  }, []);

  useEffect(() => {
    if (!favoritesHydrated) return;
    window.localStorage.setItem(MY_LIST_STORAGE_KEY, JSON.stringify({ version: 1, cardIds: favoriteIds }));
  }, [favoriteIds, favoritesHydrated]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 620px)");
    const updateMobileState = () => setIsMobileBook(mediaQuery.matches);
    updateMobileState();
    mediaQuery.addEventListener("change", updateMobileState);
    return () => mediaQuery.removeEventListener("change", updateMobileState);
  }, []);

  useEffect(() => {
    catalogRef.current?.scrollTo({ top: 0 });
  }, [activeLibraryTab, category, maxAttack, maxCost, maxDefense, monsterType, sort]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "/" && document.activeElement !== searchRef.current) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape" && document.activeElement === searchRef.current) {
        setQuery("");
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const selectCategory = (value: string) => {
    setCategory(value);
    setMonsterType("all");
  };

  const selectMonsterType = (value: string) => {
    setCategory(value === "all" ? "all" : "Monster");
    setMonsterType(value);
  };

  const changeMobileCardPage = (nextPage: number) => {
    const clampedPage = Math.max(0, Math.min(nextPage, mobileCardPageCount - 1));
    setMobileCardPagination({ page: clampedPage, filterKey: mobileFilterKey });
    catalogRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const activeLabel =
    monsterType !== "all"
      ? monsterType
      : primaryFilters.find((filter) => filter.value === category)?.label ?? "Todos";

  const resetFilters = () => {
    setQuery("");
    setMinAttack("");
    setMaxAttack("");
    setMinDefense("");
    setMaxDefense("");
    setMaxCost("");
    setFieldAdvantage("all");
    selectCategory("all");
  };

  return (
    <main className="archive-app">
      <aside className="filter-rail" aria-label="Filtros do catálogo">
        <div className="brand-block">
          <img
            className="game-logo"
            src="/game-assets/logo_yugioh_fm.webp"
            alt="Yu-Gi-Oh! Forbidden Memories"
            width="260"
            height="118"
          />
          <span className="project-version" aria-label="Versão 0.0.82">
            v0.0.82
          </span>
        </div>

        <div className="rail-navigation">
          <section className="filter-section" aria-labelledby="category-title">
            <div className="section-title" id="category-title">
              <span>CATEGORIAS</span>
            </div>
            <div className="primary-filters">
              {primaryFilters.map((filter) => (
                <button
                  type="button"
                  key={filter.value}
                  className={category === filter.value && monsterType === "all" ? "active" : ""}
                  onClick={() => selectCategory(filter.value)}
                  aria-pressed={category === filter.value && monsterType === "all"}
                >
                  {filter.icon ? (
                    <img className="category-filter-icon" src={filter.icon} alt="" aria-hidden="true" />
                  ) : (
                    <span className={`category-glyph category-${filter.value.toLowerCase()}`} aria-hidden="true">
                      {filter.glyph}
                    </span>
                  )}
                  <span>{filter.label}</span>
                  <small>{categoryCounts.get(filter.value) ?? 0}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="filter-section monster-filter-section" aria-labelledby="monster-type-title">
            <div className="section-title" id="monster-type-title">
              <span>TIPOS DE MONSTRO</span>
            </div>
            <div className="monster-type-grid">
              <button
                className={monsterType === "all" ? "active" : ""}
                type="button"
                onClick={() => selectMonsterType("all")}
                title="Todos os tipos"
                aria-label="Todos os tipos de monstro"
                aria-pressed={monsterType === "all"}
              >
                <span className="all-types" aria-hidden="true">ALL</span>
              </button>
              {monsterTypes.map((type) => (
                <button
                  className={monsterType === type ? "active" : ""}
                  type="button"
                  key={type}
                  onClick={() => selectMonsterType(type)}
                  title={`${type} · ${typeCounts.get(type) ?? 0} cards`}
                  aria-label={`${type}, ${typeCounts.get(type) ?? 0} cards`}
                  aria-pressed={monsterType === type}
                >
                  <TypeSpriteIcon type={type} size={23} />
                </button>
              ))}
            </div>
          </section>

          <section className="filter-section field-advantage-filter-section" aria-labelledby="field-advantage-title">
            <div className="section-title" id="field-advantage-title">
              <span>VANTAGEM EM CAMPO</span>
            </div>
            <div className="field-advantage-grid">
              {fieldAdvantageFilters.map((field) => {
                const active = fieldAdvantage === field.value;
                const count = fieldAdvantageCounts.get(field.value) ?? 0;
                return (
                  <button
                    className={active ? "active" : ""}
                    type="button"
                    key={field.value}
                    onClick={() => setFieldAdvantage(active ? "all" : field.value)}
                    title={`${field.label} · ${count} cards`}
                    aria-label={`${field.label}, ${count} cards${active ? "; clique para remover o filtro" : ""}`}
                    aria-pressed={active}
                  >
                    <FieldFilterSprite cardId={field.fieldCardId} />
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rail-tools" aria-labelledby="rail-tools-title">
            <div className="section-title rail-tools-title" id="rail-tools-title">
              <span>FILTROS DE CARTA</span>
            </div>

            <div className="stat-range-stack" aria-label="Filtrar por intervalos de ataque e defesa">
              <div className="stat-limit-filter" aria-label="Intervalo de ataque">
                <label>
                  <img src="/game-assets/atk-filter-icon.png" alt="" aria-hidden="true" />
                  <input
                    type="number"
                    min="0"
                    max="9999"
                    step="50"
                    inputMode="numeric"
                    value={minAttack}
                    onChange={(event) => setMinAttack(event.target.value)}
                    placeholder="ATK mín."
                    aria-label="Ataque mínimo"
                  />
                </label>
                <label>
                  <img src="/game-assets/atk-filter-icon.png" alt="" aria-hidden="true" />
                  <input
                    type="number"
                    min="0"
                    max="9999"
                    step="50"
                    inputMode="numeric"
                    value={maxAttack}
                    onChange={(event) => setMaxAttack(event.target.value)}
                    placeholder="ATK máx."
                    aria-label="Ataque máximo"
                  />
                </label>
              </div>
              <div className="stat-limit-filter" aria-label="Intervalo de defesa">
                <label>
                  <img src="/game-assets/def-filter-icon.png" alt="" aria-hidden="true" />
                  <input
                    type="number"
                    min="0"
                    max="9999"
                    step="50"
                    inputMode="numeric"
                    value={minDefense}
                    onChange={(event) => setMinDefense(event.target.value)}
                    placeholder="DEF mín."
                    aria-label="Defesa mínima"
                  />
                </label>
                <label>
                  <img src="/game-assets/def-filter-icon.png" alt="" aria-hidden="true" />
                  <input
                    type="number"
                    min="0"
                    max="9999"
                    step="50"
                    inputMode="numeric"
                    value={maxDefense}
                    onChange={(event) => setMaxDefense(event.target.value)}
                    placeholder="DEF máx."
                    aria-label="Defesa máxima"
                  />
                </label>
              </div>
            </div>

            <label className="cost-sort">
              <StarChip size={17} />
              <input
                type="number"
                min="0"
                max="999999"
                step="1"
                inputMode="numeric"
                value={maxCost}
              onChange={(event) => setMaxCost(event.target.value)}
              placeholder="Custo máximo"
              aria-label="Custo máximo em Starchips"
            />
            </label>

            <label className="rail-search">
              <span className="search-glyph" aria-hidden="true">⌕</span>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              placeholder="Nome, nº ou Password"
              aria-label="Pesquisar cards"
            />
            </label>
          </section>
        </div>

        <footer className="rail-signature">
          <img
            className="colucci-design-logo"
            src="/game-assets/LOGO_COLUCCI_DESIGN_NEW.png"
            alt="Colucci Design"
            width="132"
            height="57"
          />
          <small>© Direitos reservados - 2026</small>
        </footer>
      </aside>

      <section className="archive-workspace">
        <header className="archive-header">
          <nav className="library-tabs" role="tablist" aria-label="Coleções de cartas">
            <button
              type="button"
              id="card-book-tab"
              role="tab"
              aria-controls="card-library-panel"
              aria-selected={activeLibraryTab === "card-book"}
              className={activeLibraryTab === "card-book" ? "active" : ""}
              onClick={() => setActiveLibraryTab("card-book")}
            >
              <span className="library-tab-book" aria-hidden="true" />
              <strong>CARD BOOK</strong>
            </button>
            <button
              type="button"
              id="my-list-tab"
              role="tab"
              aria-controls="card-library-panel"
              aria-selected={activeLibraryTab === "my-list"}
              className={activeLibraryTab === "my-list" ? "active" : ""}
              onClick={() => setActiveLibraryTab("my-list")}
            >
              <span className="pixel-heart" aria-hidden="true" />
              <strong>MY LIST</strong>
              <small>{favoriteIds.length}</small>
            </button>
          </nav>

          <div className="header-status" aria-live="polite">
            <div>
              <span>EXIBINDO</span>
              <strong>{filteredCards.length}</strong>
              <small>/ {catalogCards.length}</small>
            </div>
            <div className="header-divider" />
            <div>
              <span>FILTRO ATIVO</span>
              <b>{activeLabel}</b>
            </div>
          </div>

          <label className="header-sort">
            <span>ORDEM</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
              <option value="number">Nº DO CARD</option>
              <option value="name">NOME A–Z</option>
              <option value="cost-low">MENOR CUSTO</option>
              <option value="cost-high">MAIOR CUSTO</option>
            </select>
          </label>
        </header>

        <div
          className="catalog-scroll"
          ref={catalogRef}
          data-testid="catalog-scroll"
          id="card-library-panel"
          role="tabpanel"
          aria-labelledby={activeLibraryTab === "card-book" ? "card-book-tab" : "my-list-tab"}
        >
          {filteredCards.length > 0 ? (
            <>
              <div className="mini-card-grid">
                {displayedCards.map((card) => <MiniCard card={card} key={card.id} onOpen={openDetailFromCatalog} />)}
              </div>
              {isMobileBook && (
                <nav className="mobile-card-pagination" aria-label="Paginação do Card Book em grupos de quatro">
                  <button
                    type="button"
                    className="mobile-card-page-button mobile-card-page-button--previous"
                    aria-label="Mostrar as quatro cartas anteriores"
                    disabled={mobileCardPage === 0}
                    onClick={() => changeMobileCardPage(mobileCardPage - 1)}
                  />
                  <span className="mobile-card-page-counter" aria-live="polite">
                    {mobileCardPage + 1}/{mobileCardPageCount}
                  </span>
                  <button
                    type="button"
                    className="mobile-card-page-button mobile-card-page-button--next"
                    aria-label="Mostrar as próximas quatro cartas"
                    disabled={mobileCardPage >= mobileCardPageCount - 1}
                    onClick={() => changeMobileCardPage(mobileCardPage + 1)}
                  />
                </nav>
              )}
            </>
          ) : (
            <div className="empty-state">
              {activeLibraryTab === "my-list" && favoriteCards.length === 0 ? (
                <>
                  <span className="empty-favorite-heart pixel-heart" aria-hidden="true" />
                  <h2>SUA MY LIST ESTÁ VAZIA</h2>
                  <p>Abra uma carta e use o coração para guardar seus favoritos.</p>
                </>
              ) : (
                <>
                  <span className="empty-eye">◉</span>
                  <h2>Nenhum card encontrado</h2>
                  <p>Limpe a busca ou escolha outra categoria.</p>
                </>
              )}
              <button
                type="button"
                onClick={() => activeLibraryTab === "my-list" && favoriteCards.length === 0
                  ? setActiveLibraryTab("card-book")
                  : resetFilters()}
              >
                {activeLibraryTab === "my-list" && favoriteCards.length === 0 ? "ABRIR CARD BOOK" : "LIMPAR FILTROS"}
              </button>
            </div>
          )}
        </div>

      </section>
      {detailLoadError && (
        <div className="detail-load-error" role="alert">
          <strong>DETALHES INDISPONÍVEIS</strong>
          <span>{detailLoadError}</span>
          <button type="button" onClick={() => setDetailLoadError("")} aria-label="Fechar aviso">×</button>
        </div>
      )}
      {detailView && detailCardIdSet.has(detailView.card.id) && (
        <CardDetailOverlay
          detailData={detailView.data}
          open
          onClose={closeDetail}
          onPrevious={previousDetailCard ? () => void showDetailCard(previousDetailCard) : undefined}
          onNext={nextDetailCard ? () => void showDetailCard(nextDetailCard) : undefined}
          onPrefetchRelated={prefetchRelatedCard}
          onOpenRelated={openRelatedCard}
          isFavorite={favoriteIdSet.has(detailView.card.id)}
          onToggleFavorite={() => toggleFavorite(detailView.card.id)}
          returnTarget={detailHistory.at(-1) ?? null}
          onReturn={detailHistory.length > 0 ? returnFromRelatedCard : undefined}
        />
      )}
    </main>
  );
}
