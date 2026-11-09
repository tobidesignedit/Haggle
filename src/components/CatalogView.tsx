import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Search, ArrowRight, Heart, Star } from 'lucide-react';
import { formatCurrency, type PublicItem } from '../lib/bargaining';

interface CatalogViewProps {
  items: PublicItem[];
  loading: boolean;
  sessionId: string;
  autoPlayChat?: boolean;
  onSelectItem: (itemId: string) => void;
  onOpenSellerStudio: () => void;
  onOpenSellerNew: () => void;
  onOpenLogin: (role?: 'shopper' | 'maker', mode?: 'signin' | 'signup') => void;
  onCatalogMutated: () => void;
}

interface DemoProductSpec {
  id: string;
  tab: string;
  name: string;
  maker: string;
  list: number;
  ask: number;
  counter: number;
  left: string;
  gradient: string;
}

interface ChatEntry {
  id: string;
  kind: 'who' | 'typing' | 'ai' | 'me';
  text?: string;
  boldPrice?: number;
  perk?: string;
}

const CATEGORIES = ['All Goods', 'Footwear', 'Leather Goods', 'Home & Kitchen', 'Saved'];

const ITEM_RATINGS: Record<string, string> = {
  'item-cognac-boot': '4.98',
  'item-woven-sandal': '4.95',
  'item-saddle-tote': '4.99',
  'item-suede-loafer': '4.97',
  'item-weekender-duffel': '4.96',
  'item-stoneware-pourover': '4.94',
  'item-forged-knife': '4.98',
  'item-merino-throw': '4.97',
};

const STEPS = ['Offer', 'Counter', 'Locked', 'Pay'];
const PERK = 'Free 2-day express shipping';

const DEFAULT_PRODUCTS: DemoProductSpec[] = [
  {
    id: 'item-cognac-boot',
    tab: 'Ankle Boot',
    name: 'Hand-Sewn Cognac Leather Ankle Boot',
    maker: 'Born Saddlery Studio',
    list: 195,
    ask: 164,
    counter: 176,
    left: '2 left',
    gradient: 'radial-gradient(120% 120% at 30% 20%,#c98b55,#6b3d1e 55%,#2b190d)',
  },
  {
    id: 'item-woven-sandal',
    tab: 'Leather Sandal',
    name: 'Leather Sandal',
    maker: 'Born Saddlery Studio',
    list: 168,
    ask: 140,
    counter: 149,
    left: '',
    gradient: 'radial-gradient(120% 120% at 30% 20%,#e0bf94,#9a7048 55%,#51361d)',
  },
  {
    id: 'item-saddle-tote',
    tab: 'Crossbody Tote',
    name: 'Crossbody Tote',
    maker: 'Born Saddlery Studio',
    list: 245,
    ask: 200,
    counter: 219,
    left: '',
    gradient: 'radial-gradient(120% 120% at 30% 20%,#a8604a,#5e2a1f 55%,#2a120d)',
  },
];

export const CatalogView: React.FC<CatalogViewProps> = ({
  items,
  loading,
  autoPlayChat = true,
  onSelectItem,
  onOpenSellerStudio,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('All Goods');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [savedItemIds, setSavedItemIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('haggle_saved_items');
      return raw ? JSON.parse(raw) : ['item-cognac-boot'];
    } catch {
      return ['item-cognac-boot'];
    }
  });

  const toggleSaveItem = useCallback((id: string) => {
    setSavedItemIds((prev) => {
      const next = prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id];
      try {
        localStorage.setItem('haggle_saved_items', JSON.stringify(next));
      } catch {
        // Ignored
      }
      return next;
    });
  }, []);

  // PayPal Blue Chat Animation State (matches image_46cdf0d4.png layout with PayPal Blue palette)
  const demoProducts = useMemo<DemoProductSpec[]>(() => {
    return DEFAULT_PRODUCTS.map((def, index) => {
      const matched = items.find((it) => it.id === def.id) || items[index];
      if (!matched) return def;
      return {
        ...def,
        id: matched.id,
      };
    });
  }, [items]);

  const demoProductsRef = useRef<DemoProductSpec[]>(demoProducts);
  demoProductsRef.current = demoProducts;

  const [idx, setIdx] = useState<number>(0);
  const [auto, setAuto] = useState<boolean>(autoPlayChat);
  const [replayTrigger, setReplayTrigger] = useState<number>(0);

  useEffect(() => {
    setAuto(autoPlayChat);
  }, [autoPlayChat]);

  const [step, setStep] = useState<number>(0);
  const [nowPrice, setNowPrice] = useState<number>(DEFAULT_PRODUCTS[0].list);
  const [wasPrice, setWasPrice] = useState<string>('');
  const [isDealPrice, setIsDealPrice] = useState<boolean>(false);
  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([]);
  const [typedText, setTypedText] = useState<string>('Offer a price or chat…');
  const [typedMode, setTypedMode] = useState<'ph' | 'live'>('ph');
  const [sendState, setSendState] = useState<'idle' | 'ready' | 'press'>('idle');
  const [showDealView, setShowDealView] = useState<boolean>(false);
  const [lockedPrice, setLockedPrice] = useState<number>(DEFAULT_PRODUCTS[0].counter);
  const [timerText, setTimerText] = useState<string>('15:00');
  const [showPayBtn, setShowPayBtn] = useState<boolean>(false);

  const runIdRef = useRef<number>(0);
  const clockRef = useRef<number | null>(null);

  const currentProduct = demoProducts[idx] || DEFAULT_PRODUCTS[0];
  const chips = useMemo(
    () => [
      currentProduct.counter,
      currentProduct.ask,
      Math.round(currentProduct.list * 0.72),
    ],
    [currentProduct]
  );

  useEffect(() => {
    const id = ++runIdRef.current;
    const p = demoProductsRef.current[idx] || DEFAULT_PRODUCTS[0];
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (clockRef.current) {
      window.clearInterval(clockRef.current);
      clockRef.current = null;
    }

    const w = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        window.setTimeout(() => {
          if (id !== runIdRef.current) {
            reject(0);
          } else {
            resolve();
          }
        }, reduced ? Math.min(ms, 120) : ms);
      });

    const tweenPrice = (from: number, to: number, ms: number) => {
      const t0 = performance.now();
      const frame = (t: number) => {
        if (id !== runIdRef.current) return;
        const k = Math.min(1, (t - t0) / ms);
        const e = 1 - Math.pow(1 - k, 3);
        setNowPrice(Math.round(from + (to - from) * e));
        if (k < 1) {
          requestAnimationFrame(frame);
        }
      };
      requestAnimationFrame(frame);
    };

    const executeRun = async () => {
      try {
        setChatEntries([]);
        setNowPrice(p.list);
        setWasPrice('');
        setIsDealPrice(false);
        setTypedMode('ph');
        setTypedText('Offer a price or chat…');
        setSendState('idle');
        setShowDealView(false);
        setShowPayBtn(false);
        setTimerText('15:00');
        setStep(0);

        await w(500);

        // Maker AI: "Listed at $195. Make an offer!"
        setChatEntries([
          { id: 'who-1', kind: 'who' },
          { id: 'typing-1', kind: 'typing' },
        ]);
        await w(700);
        setChatEntries([
          { id: 'who-1', kind: 'who' },
          { id: 'ai-1', kind: 'ai', boldPrice: p.list, text: 'Make an offer!' },
        ]);

        await w(600);

        // Buyer types: "Hey! Would you take $164?"
        const firstOfferText = `Hey! Would you take $${p.ask}?`;
        setTypedMode('live');
        setTypedText('');
        setSendState('ready');
        for (let i = 1; i <= firstOfferText.length; i++) {
          setTypedText(firstOfferText.slice(0, i));
          await w(32 + Math.random() * 30);
        }
        await w(350);

        setSendState('press');
        await w(120);
        setSendState('idle');
        setTypedMode('ph');
        setTypedText('Offer a price or chat…');
        setChatEntries((prev) => [
          ...prev,
          { id: 'me-1', kind: 'me', text: firstOfferText },
        ]);

        // Step 1: Counter
        setStep(1);
        setChatEntries((prev) => [...prev, { id: 'typing-2', kind: 'typing' }]);
        await w(1000);
        setChatEntries((prev) => [
          ...prev.filter((item) => item.id !== 'typing-2'),
          {
            id: 'ai-2',
            kind: 'ai',
            boldPrice: p.counter,
            perk: PERK,
          },
        ]);
        setWasPrice('$' + p.list);
        setIsDealPrice(true);
        tweenPrice(p.list, p.counter, 700);
        await w(1100);

        // Buyer types: "Deal! Lock in $176."
        const acceptText = `Deal! Lock in $${p.counter}.`;
        setTypedMode('live');
        setTypedText('');
        setSendState('ready');
        for (let i = 1; i <= acceptText.length; i++) {
          setTypedText(acceptText.slice(0, i));
          await w(32 + Math.random() * 30);
        }
        await w(350);

        setSendState('press');
        await w(120);
        setSendState('idle');
        setTypedMode('ph');
        setTypedText('Offer a price or chat…');
        setChatEntries((prev) => [
          ...prev,
          { id: 'me-2', kind: 'me', text: acceptText },
        ]);

        // Step 2: Locked
        setStep(2);
        setLockedPrice(p.counter);
        setShowDealView(true);
        let s = 900;
        clockRef.current = window.setInterval(() => {
          s = Math.max(0, s - 1);
          setTimerText(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
        }, 1000);
        await w(1300);

        // Step 3: Pay
        setStep(3);
        setShowPayBtn(true);
        await w(4200);

        if (auto && id === runIdRef.current) {
          setIdx((prev) => (prev + 1) % demoProductsRef.current.length);
        }
      } catch (err) {
        if (err !== 0) {
          console.error(err);
        }
      }
    };

    executeRun();

    return () => {
      if (clockRef.current) {
        window.clearInterval(clockRef.current);
        clockRef.current = null;
      }
    };
  }, [idx, auto, replayTrigger]);

  const handleSelectTab = (newIndex: number) => {
    setAuto(false);
    setIdx(newIndex);
    setReplayTrigger((c) => c + 1);
  };

  const handleReplay = () => {
    setAuto(false);
    setReplayTrigger((c) => c + 1);
  };

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesCategory =
        selectedCategory === 'All Goods'
          ? true
          : selectedCategory === 'Saved'
            ? savedItemIds.includes(item.id)
            : item.category === selectedCategory;
      const q = searchQuery.trim().toLowerCase();
      const matchesQuery =
        !q ||
        item.title.toLowerCase().includes(q) ||
        item.sellerName.toLowerCase().includes(q) ||
        item.origin.toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [items, selectedCategory, searchQuery, savedItemIds]);

  return (
    <div className="pb-12">
      {/* =====================================================================
          1. CLEAN HERO: MINIMAL HEADLINE + PAYPAL BLUE CHAT ANIMATION PANEL
         ===================================================================== */}
      <section
        id="hero-demo"
        className="border-b border-[#CBE0F6] dark:border-white/[0.08] bg-gradient-to-b from-[#DCEBFA] via-[#EDF5FD] to-[#F7FAFF] dark:bg-[#08090A] dark:bg-none transition-colors"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 lg:py-12">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
            {/* LEFT COLUMN: Ultra-Clean Typography (matches image_b6fcadc6.png in Dark Mode) */}
            <div className="lg:col-span-6 space-y-4 animate-fade-up">
              <h1 className="font-sans text-4xl sm:text-5xl lg:text-[58px] font-semibold tracking-[-0.038em] leading-[1.04] text-[#001C64] dark:text-[#F7F8F8]">
                Chat with the AI.
                <span className="block text-[#003087] dark:text-[#F7F8F8]">
                  Agree on a price.
                </span>
              </h1>

              <p className="text-sm sm:text-lg text-[#3B5278] dark:text-[#8A8F98] leading-relaxed max-w-md font-normal">
                Bargain directly with the maker’s AI, lock your price for{' '}
                <strong className="text-[#001C64] dark:text-[#F7F8F8] font-medium">
                  15 minutes
                </strong>
                , and pay with{' '}
                <strong className="text-[#003087] dark:text-[#2E90FA] font-medium">
                  PayPal
                </strong>
                .
              </p>

              <div className="pt-1 flex flex-wrap items-center gap-3">
                <a
                  href="#how-it-works"
                  className="px-4 py-2 rounded-full bg-gradient-to-r from-[#003087] to-[#0070BA] dark:bg-none dark:bg-[#F7F8F8] text-white dark:text-[#08090A] text-xs sm:text-sm font-semibold shadow-xs hover:opacity-95 transition-opacity"
                >
                  How It Works
                </a>
                <button
                  type="button"
                  onClick={onOpenSellerStudio}
                  className="text-xs sm:text-sm font-medium text-[#003087] dark:text-[#8A8F98] hover:text-[#001C64] dark:hover:text-[#F7F8F8] underline underline-offset-4 transition-colors cursor-pointer whitespace-nowrap"
                >
                  Seller Studio →
                </button>
              </div>
            </div>

            {/* RIGHT COLUMN: PAYPAL BLUE CHAT ANIMATION PANEL (image_46cdf0d4.png) */}
            <div className="lg:col-span-6 animate-fade-up-delayed">
              <div className="haggle-demo-stage" id="demo">
                <section
                  className="panel"
                  aria-label="Live haggle demo"
                  data-testid="hero-live-demo"
                  id="hero-bargain-card"
                >
                  <header className="top">
                    <nav className="tabs" id="tabs" aria-label="Demo products">
                      {demoProducts.map((p, i) => (
                        <button
                          key={p.id}
                          type="button"
                          className="tab"
                          aria-pressed={i === idx}
                          onClick={() => handleSelectTab(i)}
                        >
                          {p.tab}
                        </button>
                      ))}
                    </nav>
                    <button
                      type="button"
                      className="icon"
                      id="replay"
                      aria-label="Replay demo"
                      onClick={handleReplay}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 12a9 9 0 1 0 3-6.7" />
                        <path d="M3 4v5h5" />
                      </svg>
                    </button>
                  </header>

                  <div className="product">
                    <div className="thumb" style={{ background: currentProduct.gradient }} />
                    <div className="meta">
                      <div className="maker">{currentProduct.maker}</div>
                      <h3 className="title" id="title">
                        {currentProduct.name}
                      </h3>
                    </div>
                    <div className={`price ${isDealPrice ? 'deal' : ''}`} id="price">
                      <div className="prow">
                        <s id="was">{wasPrice}</s>
                        <b id="now">${nowPrice}</b>
                      </div>
                      <span id="left">{currentProduct.left}</span>
                    </div>
                  </div>

                  <div className="progress" data-testid="hero-demo-progress">
                    <div
                      className="segs"
                      id="segs"
                      role="img"
                      aria-label={`Step ${step + 1} of 4`}
                    >
                      {[0, 1, 2, 3].map((s) => (
                        <i key={s} className={s <= step ? 'on' : ''} />
                      ))}
                    </div>
                    <span id="step">{STEPS[step]}</span>
                  </div>

                  <div className="chat" id="chat" aria-live="polite" data-testid="hero-chat-stream">
                    {chatEntries.map((entry) => {
                      if (entry.kind === 'who') {
                        return (
                          <span key={entry.id} className="who">
                            Maker AI
                          </span>
                        );
                      }
                      if (entry.kind === 'typing') {
                        return (
                          <div key={entry.id} className="typing">
                            <i />
                            <i />
                            <i />
                          </div>
                        );
                      }
                      if (entry.kind === 'ai') {
                        if (entry.perk) {
                          return (
                            <div key={entry.id} className="msg ai">
                              I can meet you at <b>${entry.boldPrice}</b> +{' '}
                              <span className="perk">{entry.perk}</span>.
                            </div>
                          );
                        }
                        return (
                          <div key={entry.id} className="msg ai">
                            Listed at <b>${entry.boldPrice}</b>. {entry.text}
                          </div>
                        );
                      }
                      return (
                        <div key={entry.id} className="msg me">
                          {entry.text}
                        </div>
                      );
                    })}
                  </div>

                  <footer className="dock">
                    <div className={`view ${showDealView ? 'hide' : ''}`} id="composer">
                      <div className="chips" id="chips">
                        {chips.map((v) => (
                          <button
                            key={v}
                            type="button"
                            className="chip"
                            onClick={() => onSelectItem(currentProduct.id)}
                          >
                            ${v}
                          </button>
                        ))}
                      </div>
                      <div
                        className="composer"
                        onClick={() => onSelectItem(currentProduct.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            onSelectItem(currentProduct.id);
                          }
                        }}
                      >
                        <span className="cur">$</span>
                        <span id="typed" className={typedMode}>
                          {typedText}
                        </span>
                        <span
                          className={`send ${
                            sendState === 'ready'
                              ? 'ready'
                              : sendState === 'press'
                                ? 'ready press'
                                : ''
                          }`}
                          id="send"
                        >
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M12 19V5M5 12l7-7 7 7" />
                          </svg>
                        </span>
                      </div>
                    </div>

                    <div className={`view ${showDealView ? '' : 'hide'}`} id="deal">
                      <div className="lock">
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="4" y="11" width="16" height="10" rx="3" />
                          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                        </svg>
                        <div className="l">
                          <b id="lockedPrice">${lockedPrice}</b>Price locked
                        </div>
                        <span className="timer" id="timer">
                          {timerText}
                        </span>
                      </div>
                      <button
                        type="button"
                        className={`pay ${showPayBtn ? 'show' : ''}`}
                        id="pay"
                        disabled={!showPayBtn}
                        onClick={() => onSelectItem(currentProduct.id)}
                      >
                        Pay ${lockedPrice} with PayPal
                      </button>
                    </div>
                  </footer>
                </section>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =====================================================================
          2. HOW IT WORKS (4-STEP STRIP)
         ===================================================================== */}
      <section
        id="how-it-works"
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8"
      >
        <div className="rounded-2xl bg-gradient-to-r from-[#003087] via-[#005EA6] to-[#0070BA] dark:bg-none dark:bg-[#0F1012] dark:border dark:border-white/[0.08] text-white dark:text-[#F7F8F8] p-4 sm:p-6 shadow-md dark:shadow-none">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-white/15 dark:border-white/[0.08]">
            <h2 className="font-sans text-lg sm:text-xl font-semibold tracking-tight text-white dark:text-[#F7F8F8]">
              How Haggle + PayPal Works
            </h2>
            <span className="text-xs text-[#99E5FF] dark:text-[#8A8F98] font-medium">
              4 steps · Under 30 seconds
            </span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#4AD7FF] dark:text-[#2E90FA]">
                01 · Offer
              </div>
              <div className="font-semibold text-sm mt-0.5 text-white dark:text-[#F7F8F8]">
                Name your price
              </div>
              <p className="text-xs text-white/80 dark:text-[#8A8F98] mt-0.5">
                Tap an offer chip or type your price in chat.
              </p>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#4AD7FF] dark:text-[#2E90FA]">
                02 · Counter
              </div>
              <div className="font-semibold text-sm mt-0.5 text-white dark:text-[#F7F8F8]">
                Maker AI responds
              </div>
              <p className="text-xs text-white/80 dark:text-[#8A8F98] mt-0.5">
                Instant counteroffer within the maker’s rules.
              </p>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#4AD7FF] dark:text-[#2E90FA]">
                03 · Lock
              </div>
              <div className="font-semibold text-sm mt-0.5 text-white dark:text-[#F7F8F8]">
                15:00 price hold
              </div>
              <p className="text-xs text-white/80 dark:text-[#8A8F98] mt-0.5">
                Your agreed price and item are reserved.
              </p>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#FFC439] dark:text-[#2E90FA]">
                04 · PayPal
              </div>
              <div className="font-semibold text-sm mt-0.5 text-white dark:text-[#F7F8F8]">
                1-click checkout
              </div>
              <p className="text-xs text-white/80 dark:text-[#8A8F98] mt-0.5">
                Pay securely with PayPal Buyer Protection.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* =====================================================================
          3. CLEAN CATALOG GRID (MINIMAL FILTERS + 8 GOODS)
         ===================================================================== */}
      <section
        id="collection-grid"
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#CBE0F6] dark:border-white/[0.08] pb-3">
          {/* Category Pills */}
          <div
            role="tablist"
            aria-label="Product Categories"
            className="flex items-center gap-2 overflow-x-auto no-scrollbar"
          >
            {CATEGORIES.map((category) => {
              const active = selectedCategory === category;
              const label =
                category === 'Saved' ? `Saved (${savedItemIds.length})` : category;
              return (
                <button
                  key={category}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSelectedCategory(category)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer shrink-0 whitespace-nowrap ${
                    active
                      ? 'bg-gradient-to-r from-[#003087] to-[#0070BA] dark:bg-none dark:bg-[#F7F8F8] text-white dark:text-[#08090A] shadow-2xs'
                      : 'bg-white dark:bg-[#0F1012] text-[#3B5278] dark:text-[#8A8F98] hover:text-[#001C64] dark:hover:text-[#F7F8F8] border border-[#CBE0F6] dark:border-white/[0.08]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Compact Search */}
          <div className="relative w-full sm:w-60">
            <Search className="w-3.5 h-3.5 text-[#0070BA] dark:text-[#8A8F98] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              aria-label="Search handmade goods"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search goods..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-[#0F1012] border border-[#CBE0F6] dark:border-white/[0.08] rounded-full text-[#001C64] dark:text-[#F7F8F8] placeholder-[#5B7499] dark:placeholder-[#62666D] outline-none focus:border-[#0070BA] dark:focus:border-white/30"
            />
          </div>
        </div>

        {/* 4-Column Product Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-2.5 animate-pulse">
                <div className="aspect-4/3 rounded-2xl bg-[#E1EFFA] dark:bg-[#141518]" />
                <div className="h-4 w-2/3 rounded bg-[#E1EFFA] dark:bg-[#141518]" />
                <div className="h-3 w-1/3 rounded bg-[#E1EFFA] dark:bg-[#141518]" />
              </div>
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-[#0F1012] border border-[#CBE0F6] dark:border-white/[0.08] p-8 text-center space-y-2">
            <div className="font-sans text-base font-semibold text-[#001C64] dark:text-[#F7F8F8]">
              No matching goods
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedCategory('All Goods');
                setSearchQuery('');
              }}
              className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-[#003087] to-[#0070BA] dark:bg-none dark:bg-[#F7F8F8] text-white dark:text-[#08090A] text-xs font-semibold cursor-pointer"
            >
              Reset
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {filteredItems.map((item) => {
              const soldOut = item.stock <= 0;
              const typicalDeal = Math.round(item.askingPrice * 0.9);
              const isSaved = savedItemIds.includes(item.id);
              const rating = ITEM_RATINGS[item.id] || '4.96';

              return (
                <article
                  key={item.id}
                  data-testid={`product-card-${item.id}`}
                  className="group flex flex-col bg-white dark:bg-[#0F1012] rounded-2xl border border-[#CBE0F6] dark:border-white/[0.08] p-2.5 hover:border-[#0070BA] dark:hover:border-white/25 shadow-2xs transition-all"
                >
                  <div className="relative aspect-4/3 w-full rounded-xl bg-[#E1EFFA] dark:bg-[#16171B] overflow-hidden mb-2.5">
                    <button
                      type="button"
                      disabled={soldOut}
                      onClick={() => onSelectItem(item.id)}
                      className="w-full h-full block text-left cursor-pointer disabled:cursor-not-allowed"
                    >
                      <img
                        src={item.imageUrl}
                        alt={item.title}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          e.currentTarget.src =
                            '/src/assets/images/born_cognac_leather_boot_1794051636673.jpg';
                        }}
                        className={`w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03] ${
                          soldOut ? 'opacity-50 grayscale' : ''
                        }`}
                      />
                    </button>

                    <button
                      type="button"
                      data-testid={`wishlist-btn-${item.id}`}
                      aria-label={isSaved ? 'Remove from saved' : 'Save item'}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSaveItem(item.id);
                      }}
                      className="absolute top-2.5 right-2.5 p-1.5 rounded-full cursor-pointer z-10"
                    >
                      <Heart
                        className={`w-4 h-4 transition-colors ${
                          isSaved
                            ? 'text-[#0070BA] fill-[#0070BA] dark:text-[#F7F8F8] dark:fill-[#F7F8F8]'
                            : 'text-white fill-black/35 hover:fill-black/50'
                        }`}
                      />
                    </button>
                  </div>

                  <div className="flex-1 flex flex-col justify-between space-y-2 px-0.5">
                    <div>
                      <div className="flex items-center justify-between gap-1 text-xs text-[#3B5278] dark:text-[#8A8F98]">
                        <span className="truncate">{item.sellerName}</span>
                        <span className="inline-flex items-center gap-0.5 font-medium text-[#001C64] dark:text-[#F7F8F8] shrink-0">
                          <Star className="w-3 h-3 fill-[#0070BA] text-[#0070BA] dark:fill-[#F7F8F8] dark:text-[#F7F8F8]" />
                          <span>{rating}</span>
                        </span>
                      </div>

                      <h3 className="font-sans text-sm font-semibold text-[#001C64] dark:text-[#F7F8F8] line-clamp-1 mt-0.5">
                        {item.title}
                      </h3>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#E1EFFA] dark:border-white/[0.08]">
                      <div className="text-xs">
                        <span className="font-mono font-bold text-[#003087] dark:text-[#2E90FA]">
                          ~{formatCurrency(typicalDeal)}
                        </span>{' '}
                        <span className="font-mono text-[11px] text-[#5B7499] dark:text-[#62666D] line-through">
                          {formatCurrency(item.askingPrice)}
                        </span>
                      </div>

                      <button
                        type="button"
                        data-testid={`negotiate-btn-${item.id}`}
                        disabled={soldOut}
                        onClick={() => onSelectItem(item.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 whitespace-nowrap ${
                          soldOut
                            ? 'bg-[#E1EFFA] dark:bg-[#16171B] text-[#5B7499] dark:text-[#62666D] cursor-not-allowed'
                            : 'bg-gradient-to-r from-[#003087] to-[#0070BA] hover:from-[#001C64] hover:to-[#003087] dark:bg-none dark:bg-[#F7F8F8] dark:hover:bg-white text-white dark:text-[#08090A] cursor-pointer shadow-2xs'
                        }`}
                      >
                        <span>{soldOut ? 'Sold out' : 'Chat AI'}</span>
                        {!soldOut && <ArrowRight className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
