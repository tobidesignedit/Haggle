import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowLeft,
  Mic,
  MicOff,
  Send,
  Lock,
  CheckCircle2,
  RotateCcw,
  Clock,
  ShieldCheck,
  CreditCard,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  XCircle,
  Heart,
  Star,
} from 'lucide-react';
import {
  formatCurrency,
  type PublicItem,
  type NegotiationTurn,
  type DealRecord,
  type StructuredNegotiationState,
} from '../lib/bargaining';

interface BargainingRoomProps {
  itemId: string;
  sessionId: string;
  allItems?: PublicItem[];
  onSelectItem?: (itemId: string) => void;
  onBack: () => void;
  onDealUpdated: () => void;
}

interface BrowserSpeechRecognitionEvent {
  results: {
    [index: number]: {
      [index: number]: {
        transcript: string;
      };
      isFinal?: boolean;
    };
    length: number;
  };
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const BargainingRoom: React.FC<BargainingRoomProps> = ({
  itemId,
  sessionId,
  allItems = [],
  onSelectItem,
  onBack,
  onDealUpdated,
}) => {
  const [item, setItem] = useState<PublicItem | null>(null);
  const [turns, setTurns] = useState<NegotiationTurn[]>([]);
  const [currentCounterPrice, setCurrentCounterPrice] = useState<number>(0);
  const [unlockedConcessions, setUnlockedConcessions] = useState<string[]>([]);
  const [activeDeal, setActiveDeal] = useState<DealRecord | null>(null);
  const [remainingLockMs, setRemainingLockMs] = useState<number>(0);
  const [negotiationState, setNegotiationState] =
    useState<StructuredNegotiationState>('NEGOTIATING');
  const [loading, setLoading] = useState<boolean>(true);
  const [sending, setSending] = useState<boolean>(false);

  // Mobile Product Details Drawer State (collapsed by default on mobile so chat is full-screen above fold)
  const [showMobileDetails, setShowMobileDetails] = useState<boolean>(false);

  // Composer Inputs
  const [offerAmountInput, setOfferAmountInput] = useState<string>('');
  const [messageInput, setMessageInput] = useState<string>('');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);

  // Voice Recognition
  const [isListening, setIsListening] = useState<boolean>(false);
  const [voiceTranscriptPreview, setVoiceTranscriptPreview] = useState<string>('');
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);

  // PayPal Checkout State
  const [buyerEmail, setBuyerEmail] = useState<string>('alex.morgan@gmail.com');
  const [paypalStep, setPaypalStep] = useState<'IDLE' | 'CREATING' | 'CAPTURING' | 'PAID'>('IDLE');
  const [paypalMode, setPaypalMode] = useState<string>('PAYPAL_SANDBOX_SIMULATOR');
  const [guestCheckoutUsed, setGuestCheckoutUsed] = useState<boolean>(false);
  const [isSaved, setIsSaved] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('haggle_saved_items');
      const list: string[] = raw ? JSON.parse(raw) : ['item-cognac-boot'];
      return list.includes(itemId);
    } catch {
      return false;
    }
  });

  const handleToggleWishlist = () => {
    setIsSaved((prev) => {
      const nextState = !prev;
      try {
        const raw = localStorage.getItem('haggle_saved_items');
        const list: string[] = raw ? JSON.parse(raw) : ['item-cognac-boot'];
        const updated = nextState
          ? Array.from(new Set([...list, itemId]))
          : list.filter((id) => id !== itemId);
        localStorage.setItem('haggle_saved_items', JSON.stringify(updated));
      } catch {
        // Ignored
      }
      return nextState;
    });
  };

  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  const loadRoom = useCallback(async () => {
    try {
      setLoading(true);
      setErrorBanner(null);
      setCancelNotice(null);
      const res = await fetch(
        `/api/items/${encodeURIComponent(itemId)}?sessionId=${encodeURIComponent(sessionId)}`
      );
      if (!res.ok) {
        setErrorBanner('Could not load this handmade item.');
        return;
      }
      const data = await res.json();
      setItem(data.item);
      const loadedTurns: NegotiationTurn[] = data.session?.turns || [];
      setTurns(loadedTurns);
      setCurrentCounterPrice(data.session?.currentCounterPrice ?? data.item.askingPrice);
      setUnlockedConcessions(data.session?.unlockedConcessions || []);
      setActiveDeal(data.activeDeal || null);
      setRemainingLockMs(data.remainingLockMs || 0);
      if (data.activeDeal?.status === 'paid') {
        setPaypalStep('PAID');
        setNegotiationState('ACCEPTED');
      } else if (data.activeDeal?.status === 'agreed') {
        setPaypalStep('IDLE');
        setNegotiationState('ACCEPTED');
      } else if (loadedTurns.length > 1) {
        setPaypalStep('IDLE');
        setNegotiationState('COUNTEROFFERED');
      } else {
        setPaypalStep('IDLE');
        setNegotiationState('NEGOTIATING');
      }
    } catch {
      setErrorBanner('Network error loading negotiation room.');
    } finally {
      setLoading(false);
    }
  }, [itemId, sessionId]);

  useEffect(() => {
    loadRoom();
  }, [loadRoom]);

  // Live 1-second countdown for locked deals
  useEffect(() => {
    if (!activeDeal || activeDeal.status !== 'agreed' || !activeDeal.expiresAt) {
      return;
    }
    const tick = () => {
      const rem = Math.max(0, activeDeal.expiresAt! - Date.now());
      setRemainingLockMs(rem);
      if (rem === 0) {
        setActiveDeal((prev) => (prev ? { ...prev, status: 'expired' } : null));
        setNegotiationState('EXPIRED');
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [activeDeal]);

  useEffect(() => {
    if (turns.length > 1 && messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [turns.length, sending]);

  const handleSendOffer = async (
    e?: React.FormEvent,
    overrideOffer?: number | null,
    overrideText?: string
  ) => {
    if (e) e.preventDefault();
    if (!item || sending) return;

    const parsedOffer =
      overrideOffer !== undefined
        ? overrideOffer
        : offerAmountInput.trim() !== ''
          ? Number(offerAmountInput.replace(/[^0-9.]/g, ''))
          : null;

    const cleanText =
      overrideText !== undefined
        ? overrideText
        : messageInput.trim() ||
          (parsedOffer
            ? `I'd like to offer ${formatCurrency(parsedOffer)} for the ${item.title}.`
            : '');

    if (!cleanText && !parsedOffer) return;

    try {
      setSending(true);
      setErrorBanner(null);
      setCancelNotice(null);
      setMessageInput('');
      setOfferAmountInput('');
      setVoiceTranscriptPreview('');

      const res = await fetch('/api/negotiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: item.id,
          sessionId,
          message: cleanText,
          explicitOffer: parsedOffer && Number.isFinite(parsedOffer) ? parsedOffer : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorBanner(data.error || 'Could not process offer.');
        return;
      }

      setItem(data.item);
      setTurns(data.session.turns || []);
      setCurrentCounterPrice(data.session.currentCounterPrice);
      setUnlockedConcessions(data.session.unlockedConcessions || []);
      setActiveDeal(data.activeDeal || null);
      setRemainingLockMs(data.remainingLockMs || 0);
      if (data.negotiationState) {
        setNegotiationState(data.negotiationState);
      }
      onDealUpdated();
    } catch {
      setErrorBanner('Network error while sending your offer.');
    } finally {
      setSending(false);
    }
  };

  const handleDeclineOffer = async () => {
    if (!item || sending) return;
    await handleSendOffer(
      undefined,
      null,
      `I'll pass on ${formatCurrency(currentCounterPrice)} for now, thank you.`
    );
  };

  const handleLockCurrentCounter = async () => {
    if (!item || sending) return;
    try {
      setSending(true);
      setErrorBanner(null);
      setCancelNotice(null);
      const res = await fetch('/api/deals/lock-counter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, sessionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorBanner(data.error || 'Could not lock price.');
        return;
      }
      setActiveDeal(data.activeDeal);
      setRemainingLockMs(data.remainingLockMs);
      setTurns(data.session.turns || []);
      setCurrentCounterPrice(data.session.currentCounterPrice);
      setUnlockedConcessions(data.session.unlockedConcessions || []);
      setNegotiationState('ACCEPTED');
      onDealUpdated();
    } finally {
      setSending(false);
    }
  };

  const handleResetNegotiation = async () => {
    if (!item) return;
    const res = await fetch(`/api/items/${encodeURIComponent(item.id)}/reset-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    if (res.ok) {
      const data = await res.json();
      setItem(data.item);
      setTurns(data.session.turns || []);
      setCurrentCounterPrice(data.session.currentCounterPrice);
      setUnlockedConcessions(data.session.unlockedConcessions || []);
      setActiveDeal(null);
      setRemainingLockMs(0);
      setPaypalStep('IDLE');
      setNegotiationState('NEGOTIATING');
      setErrorBanner(null);
      setCancelNotice(null);
      onDealUpdated();
    }
  };

  const handleCancelPayPalCheckout = async () => {
    if (!activeDeal) return;
    try {
      setErrorBanner(null);
      const res = await fetch('/api/paypal/cancel-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealId: activeDeal.id,
          reason: 'Buyer cancelled PayPal window before capture',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setPaypalStep('IDLE');
        setCancelNotice(
          data.message ||
            'Checkout cancelled. Your 15-minute locked price is still active — retry whenever ready.'
        );
      }
    } catch {
      setCancelNotice('Checkout cancelled locally. Your 15-minute price hold remains active.');
    }
  };

  const handlePayPalCheckout = async (asGuestCard: boolean = false) => {
    if (!activeDeal || !item) return;
    try {
      setErrorBanner(null);
      setCancelNotice(null);
      setGuestCheckoutUsed(asGuestCard);
      setPaypalStep('CREATING');

      const createIdempotencyKey = `idem-create-${activeDeal.id}`;
      const createRes = await fetch('/api/paypal/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-idempotency-key': createIdempotencyKey,
        },
        body: JSON.stringify({
          dealId: activeDeal.id,
          idempotencyKey: createIdempotencyKey,
        }),
      });

      const createData = await createRes.json();
      if (!createRes.ok) {
        setPaypalStep('IDLE');
        setErrorBanner(createData.error || 'Could not create PayPal order.');
        if (createRes.status === 410) {
          setActiveDeal((prev) => (prev ? { ...prev, status: 'expired' } : null));
          setNegotiationState('EXPIRED');
        }
        return;
      }

      if (createData.paypalMode) {
        setPaypalMode(createData.paypalMode);
      }

      setPaypalStep('CAPTURING');
      const captureIdempotencyKey = `idem-capture-${activeDeal.id}`;
      const captureRes = await fetch('/api/paypal/capture-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-idempotency-key': captureIdempotencyKey,
        },
        body: JSON.stringify({
          dealId: activeDeal.id,
          paypalOrderId: createData.paypalOrderId,
          idempotencyKey: captureIdempotencyKey,
          buyerEmail,
        }),
      });

      const captureData = await captureRes.json();
      if (!captureRes.ok) {
        setPaypalStep('IDLE');
        setErrorBanner(captureData.error || 'PayPal payment capture failed.');
        return;
      }

      setActiveDeal(captureData.deal);
      setItem(captureData.item);
      setPaypalStep('PAID');
      setNegotiationState('ACCEPTED');
      onDealUpdated();
    } catch {
      setPaypalStep('IDLE');
      setErrorBanner('PayPal checkout encountered a network error.');
    }
  };

  const toggleVoiceInput = () => {
    const SpeechRecognitionCtor =
      (window as unknown as { SpeechRecognition?: new () => BrowserSpeechRecognition })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => BrowserSpeechRecognition })
        .webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      const targetPrice = item ? Math.round(item.askingPrice * 0.9) : 175;
      const samplePhrase = `Can we do ${formatCurrency(targetPrice)} with free express shipping?`;
      setVoiceTranscriptPreview(samplePhrase);
      setMessageInput(samplePhrase);
      setOfferAmountInput(String(targetPrice));
      return;
    }

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRecognitionCtor();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: BrowserSpeechRecognitionEvent) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setVoiceTranscriptPreview(transcript);
        setMessageInput(transcript);
      };

      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);

      recognitionRef.current = recognition;
      setIsListening(true);
      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  if (loading || !item) {
    return (
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-10">
        <div className="h-[480px] rounded-xl bg-white border border-[#E5DDD0] p-6 flex items-center justify-center text-sm text-[#665E57]">
          Loading item details and negotiation chat...
        </div>
      </div>
    );
  }

  const isLocked =
    activeDeal?.status === 'agreed' && remainingLockMs > 0 && paypalStep !== 'PAID';
  const isExpired =
    activeDeal?.status === 'expired' ||
    (activeDeal?.status === 'agreed' && remainingLockMs === 0);
  const isPaid = activeDeal?.status === 'paid' || paypalStep === 'PAID';

  const effectiveState: StructuredNegotiationState = isPaid
    ? 'ACCEPTED'
    : isExpired
      ? 'EXPIRED'
      : isLocked
        ? 'ACCEPTED'
        : negotiationState;

  const step5Pct = Math.round(item.askingPrice * 0.95);
  const step10Pct = Math.round(item.askingPrice * 0.9);
  const step15Pct = Math.round(item.askingPrice * 0.85);

  const displayedPrice = activeDeal?.agreedPrice ?? currentCounterPrice ?? item.askingPrice;
  const currentSavings = Math.max(0, item.askingPrice - displayedPrice);

  const relatedItems = allItems.filter((cand) => cand.id !== item.id).slice(0, 3);

  return (
    <div className="max-w-7xl mx-auto px-2.5 sm:px-6 lg:px-8 py-2 sm:py-6 pb-6 sm:pb-16 animate-fade-up">
      {/* Compact Top Bar: minimal on mobile so BargainingRoom feels full-screen */}
      <div className="flex items-center justify-between gap-2 mb-2 sm:mb-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-[#222222] hover:underline transition-colors cursor-pointer py-1"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Back to all handmade goods</span>
          <span className="sm:hidden">Catalog</span>
        </button>

        {/* Mobile Compact Item Identity Strip */}
        <div className="flex lg:hidden items-center gap-2 min-w-0 flex-1 justify-center">
          <img
            src={item.imageUrl}
            alt={item.title}
            referrerPolicy="no-referrer"
            className="w-6 h-6 rounded-md object-cover border border-[#DDDDDD] shrink-0"
          />
          <span className="text-xs font-bold text-[#222222] truncate">{item.title}</span>
          <button
            type="button"
            onClick={() => setShowMobileDetails((prev) => !prev)}
            className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[#FF385C] shrink-0 cursor-pointer"
          >
            <span>{showMobileDetails ? 'Hide info' : 'Details'}</span>
            {showMobileDetails ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        <div className="flex items-center gap-3 text-xs text-[#717171] shrink-0">
          <button
            type="button"
            onClick={handleToggleWishlist}
            className="inline-flex items-center gap-1.5 font-semibold text-[#222222] hover:bg-[#F7F7F7] px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
          >
            <Heart
              className={`w-4 h-4 ${
                isSaved ? 'text-[#FF385C] fill-[#FF385C]' : 'text-[#222222]'
              }`}
            />
            <span className="hidden sm:inline">{isSaved ? 'Saved' : 'Save'}</span>
          </button>
          <button
            type="button"
            onClick={handleResetNegotiation}
            className="inline-flex items-center gap-1 font-medium text-[#717171] hover:text-[#222222] cursor-pointer py-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Start fresh offer</span>
            <span className="sm:hidden">Reset</span>
          </button>
        </div>
      </div>

      {/* Desktop Airbnb Listing Title & Metadata Bar */}
      <div className="hidden lg:flex items-end justify-between gap-4 pb-5 mb-6 border-b border-[#EBEBEB]">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-[#222222]">
            {item.title}
          </h1>
          <div className="flex items-center gap-2 text-xs sm:text-sm text-[#717171] mt-1">
            <span className="inline-flex items-center gap-1 font-semibold text-[#222222] tabular-nums">
              <Star className="w-3.5 h-3.5 fill-[#222222] text-[#222222]" />
              <span>4.98</span>
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-medium text-[#222222] underline">
              Verified Maker Studio
            </span>
            <span aria-hidden="true">·</span>
            <span>{item.sellerName}</span>
            <span aria-hidden="true">·</span>
            <span className="underline">{item.origin}</span>
          </div>
        </div>
        <div className="text-xs text-[#717171]">
          {item.stock > 0 ? (
            <span className="font-semibold text-[#0F523E]">
              Open to offers · {item.stock} handcrafted pieces in stock
            </span>
          ) : (
            <span className="font-semibold text-[#8C827A]">Sold out</span>
          )}
        </div>
      </div>

      {/* Main 2-Column Split: Left Airbnb Studio & Craftsmanship Showcase, Right Sticky Reserve/Negotiate Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 lg:gap-10 items-start">
        {/* LEFT COLUMN: Product Photography, "Crafted by Maker" Host Header & 3 Airbnb Highlights (5 cols on desktop) */}
        <div
          className={`${
            showMobileDetails ? 'block' : 'hidden lg:block'
          } lg:col-span-5 bg-white rounded-2xl border border-[#EBEBEB] overflow-hidden`}
        >
          <div className="aspect-4/3 w-full bg-[#F3EDE4] overflow-hidden">
            <img
              src={item.imageUrl}
              alt={item.title}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>

          <div className="p-4 sm:p-6 space-y-5">
            {/* Airbnb "Hosted / Crafted by [Studio]" Header Row */}
            <div className="flex items-center justify-between gap-3 pb-4 border-b border-[#EBEBEB]">
              <div>
                <h2 className="font-serif text-base sm:text-lg font-bold text-[#222222]">
                  Crafted by {item.sellerName}
                </h2>
                <div className="text-xs text-[#717171] mt-0.5">
                  {item.origin} · {item.category} · Direct studio dispatch
                </div>
              </div>
              <div className="w-11 h-11 rounded-full bg-[#222222] text-white font-serif font-bold text-sm flex items-center justify-center shrink-0">
                {item.sellerName.slice(0, 2).toUpperCase()}
              </div>
            </div>

            {/* 3 Airbnb-Style Listing Highlights */}
            <div className="space-y-3.5 pb-4 border-b border-[#EBEBEB] text-xs">
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-4 h-4 text-[#222222] shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-[#222222]">Authorized Maker AI Agent</div>
                  <div className="text-[#717171]">
                    Pre-approved by {item.sellerName} to negotiate prices and unlock studio perks.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Clock className="w-4 h-4 text-[#222222] shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-[#222222]">15-Minute Server Price Lock</div>
                  <div className="text-[#717171]">
                    Once you agree on a price, your deal is reserved on the server for 15 minutes.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <CreditCard className="w-4 h-4 text-[#0070BA] shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-[#222222]">PayPal Buyer Protection</div>
                  <div className="text-[#717171]">
                    Settled via PayPal Orders v2. You won’t be charged until you confirm checkout.
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-[#222222]">About this piece</div>
              <p className="text-xs sm:text-sm text-[#717171] leading-relaxed">
                {item.description}
              </p>
              <p className="text-xs text-[#717171] leading-relaxed pt-1">
                {item.craftsmanshipNotes}
              </p>
            </div>

            <div className="pt-4 border-t border-[#EBEBEB] space-y-2">
              <div className="text-xs font-semibold text-[#222222]">
                What this maker offers during negotiation
              </div>
              <ul className="space-y-1.5 text-xs text-[#717171]">
                {item.concessions.map((perk) => {
                  const unlocked = unlockedConcessions.includes(perk);
                  return (
                    <li key={perk} className="flex items-center justify-between">
                      <span>{perk}</span>
                      <span
                        className={`font-semibold ${
                          unlocked ? 'text-[#0F523E]' : 'text-[#8C827A]'
                        }`}
                      >
                        {unlocked ? 'Included in your deal' : 'Ask to include'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Airbnb Sticky "Reserve / Negotiate" Floating Card */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-[#DDDDDD] flex flex-col overflow-hidden shadow-[0_6px_20px_rgba(0,0,0,0.08)] min-h-[calc(100dvh-105px)] sm:min-h-[600px]">
          {/* Authorized Maker Header Bar */}
          <div className="px-3.5 sm:px-5 py-2 sm:py-2.5 bg-[#222222] text-white flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 text-[#EBEBEB]">
              <ShieldCheck className="w-3.5 h-3.5 text-[#FF385C] shrink-0" />
              <span className="truncate">
                Authorized by <strong className="text-white">{item.sellerName}</strong>
                <span className="hidden sm:inline"> · Live negotiation &amp; 15m price lock</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span
                data-testid="negotiation-state-badge"
                className="font-mono text-[10px] sm:text-[11px] font-bold px-2 py-0.5 rounded bg-white/15 text-[#FFC439]"
              >
                {effectiveState}
              </span>
              <span className="hidden sm:inline font-mono text-[11px] text-[#DDDDDD]">
                {isPaid
                  ? '4. Paid via PayPal'
                  : isLocked
                    ? '3. Price Locked (15m)'
                    : turns.length > 1
                      ? '2. Counter-Offer Active'
                      : '1. Make an Offer'}
              </span>
            </div>
          </div>

          {/* Airbnb Reservation Card Top Summary & 2-Cell Parameter Grid */}
          <div className="px-3.5 py-2.5 sm:p-4 sm:px-6 bg-white border-b border-[#EBEBEB] space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-4">
              <div className="flex items-baseline gap-2.5">
                <div
                  data-testid="sticky-current-price"
                  className="font-mono text-xl sm:text-2xl font-bold text-[#222222] tabular-nums"
                >
                  {formatCurrency(displayedPrice)}
                </div>
                {displayedPrice < item.askingPrice && (
                  <div className="font-mono text-sm font-medium text-[#717171] line-through tabular-nums">
                    {formatCurrency(item.askingPrice)}
                  </div>
                )}
                <span className="text-xs text-[#717171]">
                  {isLocked || isPaid ? 'locked deal' : 'current price'}
                </span>

                {currentSavings > 0 && (
                  <span className="font-mono text-xs font-bold text-[#0F523E] tabular-nums">
                    · Save {formatCurrency(currentSavings)} (
                    {Math.round((currentSavings / item.askingPrice) * 100)}%)
                  </span>
                )}
              </div>

              <div>
                {isPaid ? (
                  <span className="text-xs font-bold text-[#0F523E]">Paid with PayPal</span>
                ) : isLocked ? (
                  <div
                    data-testid="countdown-timer"
                    className="flex items-center gap-1.5 text-xs font-mono font-bold text-[#0F523E] bg-[#E3F1EC] px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg tabular-nums"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>{formatCountdown(remainingLockMs)}</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-testid="instant-buy-now-btn"
                    disabled={sending}
                    onClick={handleLockCurrentCounter}
                    className="px-3.5 py-1.5 rounded-xl bg-[#FF385C] hover:bg-[#E00B41] text-white text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shadow-xs"
                  >
                    {currentCounterPrice < item.askingPrice
                      ? `Lock ${formatCurrency(currentCounterPrice)} Now`
                      : `Buy Now (${formatCurrency(item.askingPrice)})`}
                  </button>
                )}
              </div>
            </div>

            {/* Airbnb-Style 2-Cell Boxed Parameter Grid (Visible on sm+) */}
            <div className="hidden sm:grid grid-cols-2 rounded-xl border border-[#B0B0B0] overflow-hidden text-xs">
              <div className="px-3 py-2 border-r border-[#B0B0B0] bg-white">
                <div className="text-[10px] font-bold text-[#222222]">ASKING PRICE</div>
                <div className="font-mono font-semibold text-[#717171] tabular-nums">
                  {formatCurrency(item.askingPrice)} USD
                </div>
              </div>
              <div className="px-3 py-2 bg-white">
                <div className="text-[10px] font-bold text-[#222222]">
                  {isLocked || isPaid ? 'LOCKED DEAL STATUS' : 'MAKER COUNTER-OFFER'}
                </div>
                <div className="font-mono font-semibold text-[#0F523E] tabular-nums">
                  {formatCurrency(displayedPrice)} ·{' '}
                  {unlockedConcessions[0] || item.concessions[0] || 'Free 2-Day Shipping'}
                </div>
              </div>
            </div>
          </div>

          {/* Conversation Messages Stream */}
          <div
            ref={messagesContainerRef}
            className="p-3.5 sm:p-6 space-y-3.5 sm:space-y-4 overflow-y-auto flex-1 max-h-[46dvh] sm:max-h-[380px] min-h-[210px] bg-white"
          >
            {turns.map((turn) => {
              const isBuyer = turn.sender === 'buyer';
              const isSystem = turn.sender === 'system';

              if (isSystem) {
                return (
                  <div
                    key={turn.id}
                    className="p-3 rounded-lg bg-[#E3F1EC] border border-[#B8DEC9] text-xs font-semibold text-[#0F523E] flex items-center gap-2 animate-lock-reveal"
                  >
                    <Lock className="w-4 h-4 shrink-0" />
                    <span>{turn.message}</span>
                  </div>
                );
              }

              return (
                <div
                  key={turn.id}
                  className={`flex flex-col animate-message-in ${
                    isBuyer ? 'items-end' : 'items-start'
                  }`}
                >
                  <div className="text-[11px] sm:text-xs text-[#665E57] mb-1 px-1 flex items-center gap-2">
                    <span className="font-semibold text-[#1E1B18]">
                      {isBuyer ? 'You' : `${item.sellerName} (AI Agent)`}
                    </span>
                    {turn.offeredPrice && (
                      <span className="font-mono font-semibold text-[#8B4B24] tabular-nums">
                        Offer: {formatCurrency(turn.offeredPrice)}
                      </span>
                    )}
                    {!isBuyer && turn.counterPrice && (
                      <span className="font-mono font-semibold text-[#0F523E] tabular-nums">
                        Counter: {formatCurrency(turn.counterPrice)}
                      </span>
                    )}
                  </div>

                  <div
                    className={`max-w-[88%] sm:max-w-[85%] rounded-xl px-3.5 py-2.5 sm:px-4 sm:py-3 text-xs sm:text-sm leading-relaxed ${
                      isBuyer
                        ? 'bg-[#1E1B18] text-white'
                        : 'bg-[#FAF7F2] text-[#1E1B18] border border-[#E5DDD0]'
                    }`}
                  >
                    <p>
                      {!isBuyer
                        ? turn.message.replace(/^Authorized by [^.]+\.\s*/i, '')
                        : turn.message}
                    </p>
                    {!isBuyer &&
                      turn.unlockedConcessions &&
                      turn.unlockedConcessions.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-[#E5DDD0] text-[11px] sm:text-xs font-medium text-[#0F523E]">
                          Included perks: {turn.unlockedConcessions.join(' · ')}
                        </div>
                      )}
                  </div>
                </div>
              );
            })}

            {sending && (
              <div className="text-xs text-[#665E57] font-medium px-2">
                {item.sellerName}’s authorized agent is evaluating your offer...
              </div>
            )}
          </div>

          {errorBanner && (
            <div className="mx-4 sm:mx-6 mb-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorBanner}</span>
            </div>
          )}

          {cancelNotice && (
            <div
              data-testid="cancel-recovery-banner"
              className="mx-4 sm:mx-6 mb-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center justify-between gap-2"
            >
              <span>{cancelNotice}</span>
            </div>
          )}

          {/* Progressive Bottom Bar: Negotiate -> Locked + PayPal -> Paid */}
          <div className="p-3.5 sm:p-6 bg-[#FAF7F2] border-t border-[#E5DDD0] mt-auto">
            {isPaid && activeDeal ? (
              /* STAGE 3: PAID CONFIRMATION */
              <div
                data-testid="payment-success-card"
                className="p-4 sm:p-5 rounded-xl bg-white border border-[#B8DEC9] space-y-3 sm:space-y-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-6 h-6 text-[#0F523E] shrink-0" />
                    <div>
                      <h3 className="font-serif text-base sm:text-lg font-bold text-[#1E1B18]">
                        Order Confirmed — Thank You!
                      </h3>
                      <p className="text-xs text-[#57504A]">
                        Paid{' '}
                        <strong className="font-mono text-[#1E1B18]">
                          {formatCurrency(activeDeal.agreedPrice ?? currentCounterPrice)}
                        </strong>{' '}
                        via {guestCheckoutUsed ? 'PayPal Guest Card' : 'PayPal'} · Order ID{' '}
                        <span className="font-mono font-semibold text-[#003087]">
                          {activeDeal.paypalOrderId}
                        </span>
                        <span
                          title={paypalMode}
                          className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded bg-[#E1EFFA] text-[#003087] font-mono text-[10px] font-semibold"
                        >
                          PayPal v2 Verified
                        </span>
                      </p>
                    </div>
                  </div>
                  <span className="font-mono text-xs font-semibold text-[#0F523E] shrink-0">
                    {item.stock} left in stock
                  </span>
                </div>

                <div className="text-xs text-[#57504A] pt-3 border-t border-[#F3EDE4] flex flex-wrap items-center justify-between gap-3">
                  <span>
                    Receipt sent to <strong className="text-[#1E1B18]">{buyerEmail}</strong> ·
                    Includes{' '}
                    <strong className="text-[#1E1B18]">
                      {activeDeal.unlockedConcessions.join(' · ') || 'Free 2-Day Express Shipping'}
                    </strong>
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleResetNegotiation}
                      className="px-3 py-1.5 text-xs font-semibold border border-[#D5CBBF] rounded-lg bg-white hover:bg-[#F3EDE4] text-[#1E1B18] cursor-pointer"
                    >
                      Make Another Offer
                    </button>
                    <button
                      type="button"
                      onClick={onBack}
                      className="px-3.5 py-1.5 text-xs font-semibold bg-[#1E1B18] text-white rounded-lg cursor-pointer"
                    >
                      Continue Shopping
                    </button>
                  </div>
                </div>
              </div>
            ) : isLocked && activeDeal ? (
              /* STAGE 2: 15-MINUTE LOCK + ITEMIZED PAYPAL SETTLEMENT BREAKDOWN */
              <div data-testid="deal-locked-panel" className="space-y-3">
                <div className="p-3 sm:p-4 rounded-xl bg-white border border-[#0070BA]/30 space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-[#0F523E]">
                        <Lock className="w-4 h-4 shrink-0" />
                        <span>
                          Price locked at{' '}
                          {formatCurrency(activeDeal.agreedPrice ?? currentCounterPrice)}
                        </span>
                        {activeDeal.savingsAmount > 0 && (
                          <span>(You save {formatCurrency(activeDeal.savingsAmount)})</span>
                        )}
                      </div>
                      <div className="text-[11px] sm:text-xs text-[#57504A]">
                        Includes:{' '}
                        {activeDeal.unlockedConcessions.join(' · ') ||
                          'Free 2-Day Express Shipping'}
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-start gap-2 bg-[#F3EDE4] px-3 py-1.5 rounded-lg shrink-0">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-[#1E1B18]" />
                        <span className="text-[11px] text-[#57504A]">Hold:</span>
                        <span className="font-mono text-sm font-bold text-[#1E1B18] tabular-nums">
                          {formatCountdown(remainingLockMs)}
                        </span>
                      </div>
                      <button
                        type="button"
                        data-testid="cancel-paypal-btn"
                        onClick={handleCancelPayPalCheckout}
                        className="ml-2 text-[11px] font-medium text-[#665E57] hover:text-[#1E1B18] underline cursor-pointer"
                      >
                        Cancel Checkout
                      </button>
                    </div>
                  </div>

                  {/* Transparent Itemized Order Breakdown (Stripe / PayPal Checkout Benchmark) */}
                  <div className="pt-2 border-t border-[#F3EDE4] grid grid-cols-3 gap-2 text-[11px] text-[#57504A]">
                    <div>
                      <span>Asking: </span>
                      <strong className="font-mono text-[#1E1B18] tabular-nums">
                        {formatCurrency(item.askingPrice)}
                      </strong>
                    </div>
                    <div>
                      <span>Haggle Discount: </span>
                      <strong className="font-mono text-[#0F523E] tabular-nums">
                        -{formatCurrency(activeDeal.savingsAmount)}
                      </strong>
                    </div>
                    <div className="text-right">
                      <span>PayPal Total: </span>
                      <strong className="font-mono text-[#1E1B18] tabular-nums">
                        {formatCurrency(activeDeal.agreedPrice ?? currentCounterPrice)} USD
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center">
                  <div className="sm:col-span-5">
                    <label htmlFor="checkout-guest-email" className="sr-only">
                      Email for order confirmation (Guest friendly)
                    </label>
                    <input
                      id="checkout-guest-email"
                      type="email"
                      value={buyerEmail}
                      onChange={(e) => setBuyerEmail(e.target.value)}
                      placeholder="Email for receipt (guest checkout)"
                      className="w-full px-3 py-2.5 text-xs sm:text-sm bg-white border border-[#D5CBBF] rounded-lg text-[#1E1B18]"
                    />
                  </div>

                  <div className="sm:col-span-7 flex flex-col sm:flex-row gap-2">
                    <button
                      type="button"
                      data-testid="paypal-checkout-btn"
                      disabled={paypalStep === 'CREATING' || paypalStep === 'CAPTURING'}
                      onClick={() => handlePayPalCheckout(false)}
                      className="flex-1 py-2.5 sm:py-3 px-4 rounded-lg bg-[#FFC439] hover:bg-[#F2B829] text-[#003087] font-bold text-xs sm:text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap shadow-xs"
                    >
                      <span>
                        {paypalStep === 'CREATING' || paypalStep === 'CAPTURING'
                          ? 'Processing PayPal...'
                          : `Pay ${formatCurrency(activeDeal.agreedPrice ?? currentCounterPrice)} with PayPal`}
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={paypalStep === 'CREATING' || paypalStep === 'CAPTURING'}
                      onClick={() => handlePayPalCheckout(true)}
                      className="py-2.5 sm:py-3 px-3.5 rounded-lg bg-[#0070BA] hover:bg-[#005EA6] text-white font-semibold text-xs sm:text-sm transition-colors flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <CreditCard className="w-4 h-4" />
                      <span>Pay with Card</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : isExpired ? (
              /* EXPIRED DEAL RECOVERY */
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-between gap-4">
                <div className="text-xs text-amber-900">
                  <strong>15-minute price hold expired.</strong> Expired holds cannot be paid —
                  start a fresh offer to lock your price again.
                </div>
                <button
                  type="button"
                  onClick={handleResetNegotiation}
                  className="px-3.5 py-2 text-xs font-semibold bg-[#1E1B18] text-white rounded-lg cursor-pointer whitespace-nowrap"
                >
                  Start Fresh Offer
                </button>
              </div>
            ) : (
              /* STAGE 1: NEGOTIATION COMPOSER */
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-medium text-[#665E57] mr-0.5">
                      Quick offer:
                    </span>
                    {[
                      { label: `-5% (${formatCurrency(step5Pct)})`, val: step5Pct },
                      { label: `-10% (${formatCurrency(step10Pct)})`, val: step10Pct },
                      { label: `-15% (${formatCurrency(step15Pct)})`, val: step15Pct },
                    ].map((s) => (
                      <button
                        key={s.val}
                        type="button"
                        disabled={sending}
                        onClick={() => {
                          setOfferAmountInput(String(s.val));
                          setMessageInput(`Would you accept ${formatCurrency(s.val)}?`);
                        }}
                        className="px-2 py-1 text-[11px] sm:text-xs font-medium bg-white hover:bg-[#1E1B18] text-[#1E1B18] hover:text-white border border-[#D5CBBF] rounded-md transition-colors cursor-pointer whitespace-nowrap tabular-nums"
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>

                  {currentCounterPrice < item.askingPrice && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        data-testid="decline-counter-offer-btn"
                        disabled={sending}
                        onClick={handleDeclineOffer}
                        className="px-2.5 py-1.5 text-[11px] sm:text-xs font-medium border border-[#D5CBBF] bg-white hover:bg-[#F3EDE4] text-[#57504A] rounded-md transition-colors flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Decline</span>
                      </button>

                      <button
                        type="button"
                        data-testid="lock-counter-offer-btn"
                        disabled={sending}
                        onClick={handleLockCurrentCounter}
                        className="px-3 py-1.5 text-[11px] sm:text-xs font-semibold bg-[#0F523E] hover:bg-[#093B2C] text-white rounded-md transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        <span>Accept &amp; Lock {formatCurrency(currentCounterPrice)}</span>
                      </button>
                    </div>
                  )}
                </div>

                {voiceTranscriptPreview && (
                  <div className="text-xs text-[#0070BA] font-medium px-1">
                    Voice transcript: “{voiceTranscriptPreview}”
                  </div>
                )}

                <form onSubmit={(e) => handleSendOffer(e)} className="w-full">
                  <div className="flex items-center gap-1.5 sm:gap-2 w-full min-w-0">
                    <div className="w-20 sm:w-28 relative shrink-0">
                      <label htmlFor="explicit-offer-input" className="sr-only">
                        Offer Amount ($)
                      </label>
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-xs sm:text-sm font-bold text-[#665E57]">
                        $
                      </span>
                      <input
                        id="explicit-offer-input"
                        data-testid="offer-amount-input"
                        type="number"
                        min={1}
                        value={offerAmountInput}
                        onChange={(e) => setOfferAmountInput(e.target.value)}
                        placeholder={String(step10Pct)}
                        className="w-full pl-5 pr-1.5 py-2 sm:py-2.5 text-xs sm:text-sm font-mono bg-white border border-[#D5CBBF] rounded-lg text-[#1E1B18] tabular-nums"
                      />
                    </div>

                    <label htmlFor="chat-message-input" className="sr-only">
                      Message to maker
                    </label>
                    <input
                      id="chat-message-input"
                      data-testid="chat-message-input"
                      type="text"
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      placeholder="Add a note or ask for a perk..."
                      className="flex-1 min-w-0 px-2.5 sm:px-3 py-2 sm:py-2.5 text-xs sm:text-sm bg-white border border-[#D5CBBF] rounded-lg text-[#1E1B18]"
                    />

                    <button
                      type="button"
                      data-testid="voice-offer-btn"
                      onClick={toggleVoiceInput}
                      aria-label={isListening ? 'Stop voice input' : 'Speak your offer'}
                      className={`p-2 sm:p-2.5 rounded-lg border transition-colors cursor-pointer shrink-0 ${
                        isListening
                          ? 'bg-red-600 text-white border-red-600'
                          : 'bg-white text-[#57504A] border-[#D5CBBF] hover:text-[#1E1B18]'
                      }`}
                    >
                      {isListening ? (
                        <MicOff className="w-4 h-4" />
                      ) : (
                        <Mic className="w-4 h-4" />
                      )}
                    </button>

                    <button
                      type="submit"
                      data-testid="send-offer-btn"
                      disabled={sending || (!messageInput.trim() && !offerAmountInput.trim())}
                      className="px-2.5 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold bg-[#1E1B18] hover:bg-[#332E2A] disabled:opacity-50 text-white rounded-lg transition-colors flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <span>Send</span>
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Related Handmade Goods Section (visible on desktop or when scrolling down) */}
      {relatedItems.length > 0 && onSelectItem && (
        <section className="hidden sm:block mt-12 pt-8 border-t border-[#E5DDD0]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-serif text-lg font-bold text-[#1E1B18]">
              More Handmade Goods Open to Offers
            </h2>
            <button
              type="button"
              onClick={onBack}
              className="text-xs font-semibold text-[#0070BA] hover:underline cursor-pointer"
            >
              View full catalog →
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {relatedItems.map((rel) => (
              <div
                key={rel.id}
                onClick={() => onSelectItem(rel.id)}
                className="group bg-white rounded-xl border border-[#E5DDD0] p-3.5 flex items-center gap-3.5 hover:border-[#1E1B18] transition-all cursor-pointer"
              >
                <img
                  src={rel.imageUrl}
                  alt={rel.title}
                  referrerPolicy="no-referrer"
                  className="w-16 h-16 rounded-lg object-cover bg-[#F3EDE4] shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-[#665E57] truncate">
                    {rel.sellerName} · {rel.origin}
                  </div>
                  <div className="font-serif text-sm font-bold text-[#1E1B18] truncate">
                    {rel.title}
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="font-mono text-sm font-bold text-[#1E1B18]">
                      {formatCurrency(rel.askingPrice)}
                    </span>
                    <span className="text-[11px] font-semibold text-[#0F523E]">Make Offer →</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
