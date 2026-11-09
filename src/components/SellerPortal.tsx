import React, { useState, useEffect, useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
  type ICellRendererParams,
} from 'ag-grid-community';
import { signInWithPopup } from 'firebase/auth';
import {
  Eye,
  EyeOff,
  Plus,
  RotateCcw,
  Check,
  ExternalLink,
  AlertCircle,
  LogIn,
  UserCheck,
  Search,
} from 'lucide-react';
import { auth, googleAuthProvider } from '../lib/firebase';
import { formatCurrency, type SellerItem, type DealRecord } from '../lib/bargaining';

ModuleRegistry.registerModules([AllCommunityModule]);

interface SellerPortalProps {
  openNewModalInitially?: boolean;
  onSelectItemForBargain: (itemId: string) => void;
  onCatalogMutated: () => void;
}

interface DashboardMetrics {
  totalCatalogItems: number;
  inStockItems: number;
  soldOutItems: number;
  activePriceLocks: number;
  completedOrders: number;
  totalRevenue: number;
  totalMarginKept: number;
  avgDiscountPercent: number;
}

export const SellerPortal: React.FC<SellerPortalProps> = ({
  openNewModalInitially = false,
  onSelectItemForBargain,
  onCatalogMutated,
}) => {
  const [items, setItems] = useState<SellerItem[]>([]);
  const [deals, setDeals] = useState<DealRecord[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [revealFloors, setRevealFloors] = useState(true);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    askingPrice: string;
    floorPrice: string;
    stock: string;
  }>({ askingPrice: '', floorPrice: '', stock: '' });

  // AG Grid Deals Filter State
  const [dealStatusFilter, setDealStatusFilter] = useState<string>('ALL');
  const [dealQuickSearch, setDealQuickSearch] = useState<string>('');

  // In-memory Firebase Auth Seller state
  const [sellerUserEmail, setSellerUserEmail] = useState<string | null>(null);
  const [idTokenInMemory, setIdTokenInMemory] = useState<string | null>(null);

  const [showNewModal, setShowNewModal] = useState(openNewModalInitially);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // New Item Form State (Realistic Handmade Price Range)
  const [newTitle, setNewTitle] = useState('');
  const [newSellerName, setNewSellerName] = useState('Born Saddlery Studio');
  const [newOrigin, setNewOrigin] = useState('Portland, Oregon');
  const [newCategory, setNewCategory] = useState<SellerItem['category']>('Footwear');
  const [newAskingPrice, setNewAskingPrice] = useState('185');
  const [newFloorPrice, setNewFloorPrice] = useState('145');
  const [newStock, setNewStock] = useState('5');
  const [newDescription, setNewDescription] = useState('');
  const [newConcessions, setNewConcessions] = useState(
    'Free 2-Day Express Shipping, Cedar Shoe Trees Included, Leather Care Balm'
  );
  const [newImageUrl, setNewImageUrl] = useState(
    '/src/assets/images/born_cognac_leather_boot_1794051636673.jpg'
  );

  useEffect(() => {
    if (openNewModalInitially) {
      setShowNewModal(true);
    }
  }, [openNewModalInitially]);

  const fetchDashboard = async (token?: string | null) => {
    try {
      setLoading(true);
      const headers: Record<string, string> = {};
      if (token || idTokenInMemory) {
        headers.Authorization = `Bearer ${token || idTokenInMemory}`;
      }
      const res = await fetch('/api/seller/dashboard', { headers });
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setDeals(data.deals || []);
        setMetrics(data.metrics || null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  const handleGoogleSignIn = async () => {
    try {
      setFormError(null);
      const credential = await signInWithPopup(auth, googleAuthProvider);
      const token = await credential.user.getIdToken();
      setIdTokenInMemory(token);
      setSellerUserEmail(credential.user.email || 'Verified Maker');

      await fetch('/api/auth/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      setStatusNotice(`Signed in as maker (${credential.user.email}).`);
      fetchDashboard(token);
    } catch (err: unknown) {
      const code = (err as any)?.code;
      if (code === 'auth/unauthorized-domain') {
        setFormError(
          'Firebase Domain Authorization Required: Your Vercel domain is not yet on the Firebase Authorized Domains list. Maker sign-in is optional—you can edit and publish items directly.'
        );
      } else {
        setFormError('Google Sign-In was closed or blocked. You can still list and manage items as a maker.');
      }
    }
  };

  const startEditingRow = (item: SellerItem) => {
    setEditingRowId(item.id);
    setEditDraft({
      askingPrice: String(item.askingPrice),
      floorPrice: String(item.floorPrice),
      stock: String(item.stock),
    });
    setFormError(null);
  };

  const saveRowEdit = async (itemId: string) => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (idTokenInMemory) headers.Authorization = `Bearer ${idTokenInMemory}`;

      const res = await fetch(`/api/seller/items/${encodeURIComponent(itemId)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          askingPrice: Number(editDraft.askingPrice),
          floorPrice: Number(editDraft.floorPrice),
          stock: Number(editDraft.stock),
        }),
      });
      let data: any = null;
      try {
        data = await res.json();
      } catch {
        // Ignored
      }
      if (!res.ok) {
        setFormError(data?.error || 'Could not update item pricing.');
        return;
      }
      setEditingRowId(null);
      setStatusNotice(`Updated pricing for "${data.item.title}".`);
      fetchDashboard();
      onCatalogMutated();
    } catch {
      setFormError('Failed to connect to the server to update pricing.');
    }
  };

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    setFormError(null);

    // Client-side quick validations
    if (!newTitle.trim() || newTitle.trim().length < 3) {
      setModalError('Please enter a product title with at least 3 characters.');
      return;
    }

    const asking = Number(newAskingPrice);
    const floor = Number(newFloorPrice);
    const stock = Number(newStock);

    if (!Number.isFinite(asking) || asking <= 0) {
      setModalError('Asking price must be a valid dollar amount greater than 0.');
      return;
    }
    if (!Number.isFinite(floor) || floor <= 0) {
      setModalError('Secret floor price must be a valid dollar amount greater than 0.');
      return;
    }
    if (floor > asking) {
      setModalError(`Secret floor price ($${floor}) cannot exceed asking price ($${asking}).`);
      return;
    }
    if (!Number.isFinite(stock) || stock < 0) {
      setModalError('Stock must be 0 or more units.');
      return;
    }

    setSubmitting(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (idTokenInMemory) headers.Authorization = `Bearer ${idTokenInMemory}`;

      const res = await fetch('/api/seller/items', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: newTitle.trim(),
          sellerName: newSellerName.trim(),
          origin: newOrigin.trim(),
          category: newCategory,
          askingPrice: asking,
          floorPrice: floor,
          stock: stock,
          description: newDescription.trim(),
          concessions: newConcessions,
          imageUrl: newImageUrl,
        }),
      });

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        // Non-JSON response
      }

      if (!res.ok) {
        setModalError(
          data?.error || `Unable to publish item (status ${res.status}). Please check inputs.`
        );
        return;
      }

      setShowNewModal(false);
      setModalError(null);
      setNewTitle('');
      setNewDescription('');
      setStatusNotice(`Published "${data.item.title}" to the live store.`);
      await fetchDashboard();
      onCatalogMutated();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error';
      setModalError(`Failed to publish item: ${message}. Check your connection and try again.`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetCatalog = async () => {
    const res = await fetch('/api/seller/reset-catalog', { method: 'POST' });
    if (res.ok) {
      setStatusNotice('Restored default handmade catalog.');
      fetchDashboard();
      onCatalogMutated();
    }
  };

  const filteredDeals = useMemo(() => {
    return deals.filter((d) => {
      if (dealStatusFilter !== 'ALL' && d.status !== dealStatusFilter) return false;
      if (dealQuickSearch.trim() !== '') {
        const q = dealQuickSearch.toLowerCase();
        return (
          d.itemTitle.toLowerCase().includes(q) ||
          d.id.toLowerCase().includes(q) ||
          (d.paypalOrderId || '').toLowerCase().includes(q) ||
          (d.buyerEmail || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [deals, dealStatusFilter, dealQuickSearch]);

  const dealColumnDefs = useMemo<ColDef<DealRecord>[]>(
    () => [
      {
        headerName: 'Order / Deal ID',
        field: 'id',
        minWidth: 155,
        flex: 1,
        cellRenderer: (params: ICellRendererParams<DealRecord>) => {
          const d = params.data;
          if (!d) return null;
          return (
            <span className="font-mono text-xs text-[#332E2A] font-medium">
              {d.paypalOrderId || d.id}
            </span>
          );
        },
      },
      {
        headerName: 'Item Title',
        field: 'itemTitle',
        minWidth: 215,
        flex: 1.5,
        cellRenderer: (params: ICellRendererParams<DealRecord>) => {
          const d = params.data;
          if (!d) return null;
          return <span className="font-semibold text-[#1E1B18]">{d.itemTitle}</span>;
        },
      },
      {
        headerName: 'Status',
        field: 'status',
        minWidth: 135,
        flex: 0.85,
        cellRenderer: (params: ICellRendererParams<DealRecord>) => {
          const status = params.value as DealRecord['status'];
          const badgeStyle =
            status === 'paid'
              ? 'bg-[#0F523E] text-white'
              : status === 'agreed'
                ? 'bg-[#0070BA] text-white'
                : status === 'negotiating'
                  ? 'bg-[#1E1B18] text-white'
                  : 'bg-[#E5DDD0] text-[#57504A]';
          return (
            <span
              className={`font-mono text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm ${badgeStyle}`}
            >
              {status}
            </span>
          );
        },
      },
      {
        headerName: 'Asking Price',
        field: 'askingPrice',
        minWidth: 110,
        flex: 0.7,
        valueFormatter: (p) => formatCurrency(Number(p.value || 0)),
        cellClass: 'font-mono text-right text-[#665E57]',
      },
      {
        headerName: 'Agreed Price',
        field: 'agreedPrice',
        minWidth: 155,
        flex: 1,
        cellRenderer: (params: ICellRendererParams<DealRecord>) => {
          const d = params.data;
          if (!d) return null;
          const val = d.agreedPrice ?? d.currentCounterPrice ?? d.askingPrice;
          return (
            <span className="font-mono font-bold text-[#1E1B18]">
              {formatCurrency(val)}
              {d.savingsPercent > 0 ? ` (-${d.savingsPercent}%)` : ''}
            </span>
          );
        },
      },
      {
        headerName: 'Margin Kept',
        field: 'marginKeptAmount',
        minWidth: 165,
        flex: 1,
        cellRenderer: (params: ICellRendererParams<DealRecord>) => {
          const d = params.data;
          if (!d) return null;
          const amt = d.marginKeptAmount ?? 0;
          const pct = d.marginKeptPercent ?? 0;
          return (
            <span className="font-mono font-semibold text-[#0F523E]">
              +{formatCurrency(amt)} ({pct}%)
            </span>
          );
        },
      },
      {
        headerName: 'Included Perks',
        field: 'unlockedConcessions',
        minWidth: 210,
        flex: 1.35,
        valueFormatter: (p) =>
          Array.isArray(p.value) && p.value.length > 0 ? p.value.join(' · ') : 'None',
      },
      {
        headerName: 'Time',
        field: 'createdAt',
        minWidth: 95,
        flex: 0.55,
        valueFormatter: (p) =>
          p.value
            ? new Date(Number(p.value)).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })
            : '',
        cellClass: 'font-mono text-xs text-[#665E57]',
      },
    ],
    []
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 pb-24 space-y-10">
      {/* Seller Studio Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#E5DDD0] pb-6">
        <div>
          <span className="text-xs font-semibold text-[#8B4B24]">
            Maker &amp; Seller Dashboard
          </span>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold text-[#1E1B18] mt-1">
            Deals, Margins &amp; Floor Prices
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {sellerUserEmail ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#E3F1EC] text-[#0F523E] rounded-lg">
              <UserCheck className="w-3.5 h-3.5" />
              <span>{sellerUserEmail}</span>
            </span>
          ) : (
            <button
              type="button"
              onClick={handleGoogleSignIn}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold border border-[#D5CBBF] bg-white hover:bg-[#F3EDE4] text-[#1E1B18] rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Maker Sign-In</span>
            </button>
          )}

          <button
            type="button"
            data-testid="toggle-floor-visibility"
            onClick={() => setRevealFloors((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold border border-[#D5CBBF] bg-white hover:bg-[#F3EDE4] text-[#1E1B18] rounded-lg transition-colors cursor-pointer whitespace-nowrap"
          >
            {revealFloors ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span>{revealFloors ? 'Hide Floor Prices' : 'Show Floor Prices'}</span>
          </button>

          <button
            type="button"
            onClick={handleResetCatalog}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold border border-[#D5CBBF] bg-white hover:bg-[#F3EDE4] text-[#57504A] rounded-lg transition-colors cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Catalog</span>
          </button>

          <button
            type="button"
            data-testid="open-new-item-modal-btn"
            onClick={() => {
              setModalError(null);
              setShowNewModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#1E1B18] hover:bg-[#8B4B24] text-white rounded-lg transition-colors cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add New Item</span>
          </button>
        </div>
      </div>

      {/* Status Notice or Error */}
      {statusNotice && (
        <div className="p-3.5 rounded-lg bg-[#E3F1EC] border border-[#B8DEC9] text-xs font-medium text-[#0F523E] flex items-center justify-between">
          <span>{statusNotice}</span>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            className="underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {formError && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{formError}</span>
        </div>
      )}

      {/* 4-Column KPI Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-[#E5DDD0] space-y-1">
          <span className="text-xs font-medium text-[#665E57]">Paid PayPal Sales</span>
          <div className="font-mono text-2xl font-bold text-[#1E1B18] tabular-nums">
            {formatCurrency(metrics?.totalRevenue ?? 0)}
          </div>
          <p className="text-xs text-[#665E57]">
            {metrics?.completedOrders ?? 0} completed orders
          </p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E5DDD0] space-y-1">
          <span className="text-xs font-medium text-[#665E57]">Margin Kept Above Floor</span>
          <div className="font-mono text-2xl font-bold text-[#0F523E] tabular-nums">
            +{formatCurrency(metrics?.totalMarginKept ?? 0)}
          </div>
          <p className="text-xs text-[#665E57]">
            Surplus retained above secret minimum price
          </p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E5DDD0] space-y-1">
          <span className="text-xs font-medium text-[#665E57]">Active 15-Minute Locks</span>
          <div className="font-mono text-2xl font-bold text-[#0070BA] tabular-nums">
            {metrics?.activePriceLocks ?? 0}
          </div>
          <p className="text-xs text-[#665E57]">
            Agreed offers awaiting buyer PayPal checkout
          </p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E5DDD0] space-y-1">
          <span className="text-xs font-medium text-[#665E57]">Average Negotiated Discount</span>
          <div className="font-mono text-2xl font-bold text-[#1E1B18] tabular-nums">
            {metrics?.avgDiscountPercent ?? 0}%
          </div>
          <p className="text-xs text-[#665E57]">
            100% of accepted deals protected above floor
          </p>
        </div>
      </div>

      {/* SECTION 1: AG GRID DEALS & MARGINS TABLE */}
      <section className="bg-white rounded-xl border border-[#E5DDD0] overflow-hidden">
        <div className="p-5 border-b border-[#E5DDD0] flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-[#FAF7F2]">
          <div>
            <h2 className="font-serif text-xl font-bold text-[#1E1B18]">
              Buyer Deals &amp; Margins Kept
            </h2>
            <p className="text-xs text-[#57504A] mt-0.5">
              Track every active negotiation, 15-minute price lock, PayPal order, and margin kept
              above your secret floor price.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1 p-1 bg-[#F3EDE4] rounded-lg">
              {(['ALL', 'paid', 'agreed', 'negotiating', 'expired'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setDealStatusFilter(st)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer uppercase whitespace-nowrap ${
                    dealStatusFilter === st
                      ? 'bg-white text-[#1E1B18] shadow-xs'
                      : 'text-[#57504A] hover:text-[#1E1B18]'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#8C827A] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                aria-label="Filter deals table"
                value={dealQuickSearch}
                onChange={(e) => setDealQuickSearch(e.target.value)}
                placeholder="Search item or order ID..."
                className="pl-8 pr-3 py-1.5 text-xs bg-white border border-[#D5CBBF] rounded-lg text-[#1E1B18]"
              />
            </div>
          </div>
        </div>

        <div data-testid="seller-ag-grid" className="w-full" style={{ height: 340 }}>
          <AgGridReact<DealRecord>
            rowData={filteredDeals}
            columnDefs={dealColumnDefs}
            headerHeight={40}
            rowHeight={46}
            suppressCellFocus
            animateRows={false}
          />
        </div>
      </section>

      {/* SECTION 2: HANDMADE ITEMS & SECRET FLOOR PRICE RULES */}
      <section className="bg-white rounded-xl border border-[#E5DDD0] overflow-hidden">
        <div className="p-5 border-b border-[#E5DDD0] bg-[#FAF7F2] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl font-bold text-[#1E1B18]">
              Your Handmade Items &amp; Secret Floor Prices
            </h2>
            <p className="text-xs text-[#57504A] mt-0.5">
              Your secret floor price stays strictly on the server—it is never exposed to buyers or
              the AI prompt.
            </p>
          </div>
          <span className="text-xs font-medium text-[#57504A]">
            {items.length} items ({items.filter((i) => i.stock > 0).length} in stock)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E5DDD0] bg-[#F3EDE4] text-[11px] font-semibold uppercase tracking-wider text-[#57504A]">
                <th className="py-3 px-4">Item</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4 text-right">Asking Price</th>
                <th className="py-3 px-4 text-right">Secret Floor Price</th>
                <th className="py-3 px-4 text-right">Max Discount</th>
                <th className="py-3 px-4 text-center">Stock</th>
                <th className="py-3 px-4">Approved Perks</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3EDE4] text-sm">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-xs text-[#665E57]">
                    Loading seller catalog...
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const isEditing = editingRowId === item.id;
                  const maxDiscPct =
                    item.askingPrice > 0
                      ? Math.round(((item.askingPrice - item.floorPrice) / item.askingPrice) * 100)
                      : 0;

                  return (
                    <tr key={item.id} className="hover:bg-[#FAF7F2]/60">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <img
                            src={item.imageUrl}
                            alt={item.title}
                            referrerPolicy="no-referrer"
                            className="w-10 h-10 rounded-md object-cover bg-[#F3EDE4] border border-[#E5DDD0] shrink-0"
                          />
                          <div>
                            <div className="font-semibold text-[#1E1B18] text-xs sm:text-sm">
                              {item.title}
                            </div>
                            <div className="text-[11px] text-[#665E57]">
                              {item.sellerName} · {item.origin}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-xs text-[#57504A]">{item.category}</td>

                      <td className="py-3.5 px-4 text-right font-mono text-sm font-semibold text-[#1E1B18] tabular-nums">
                        {isEditing ? (
                          <input
                            type="number"
                            aria-label="Edit asking price"
                            value={editDraft.askingPrice}
                            onChange={(e) =>
                              setEditDraft((d) => ({ ...d, askingPrice: e.target.value }))
                            }
                            className="w-24 px-2 py-1 text-right border border-[#D5CBBF] rounded bg-white text-xs font-mono"
                          />
                        ) : (
                          formatCurrency(item.askingPrice)
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-right font-mono text-sm font-bold text-[#8B4B24] tabular-nums">
                        {isEditing ? (
                          <input
                            type="number"
                            aria-label="Edit floor price"
                            value={editDraft.floorPrice}
                            onChange={(e) =>
                              setEditDraft((d) => ({ ...d, floorPrice: e.target.value }))
                            }
                            className="w-24 px-2 py-1 text-right border border-[#D5CBBF] rounded bg-white text-xs font-mono"
                          />
                        ) : revealFloors ? (
                          formatCurrency(item.floorPrice)
                        ) : (
                          '••••'
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-right font-mono text-xs text-[#57504A] tabular-nums">
                        Up to {maxDiscPct}%
                      </td>

                      <td className="py-3.5 px-4 text-center font-mono text-xs tabular-nums">
                        {isEditing ? (
                          <input
                            type="number"
                            aria-label="Edit stock"
                            value={editDraft.stock}
                            onChange={(e) =>
                              setEditDraft((d) => ({ ...d, stock: e.target.value }))
                            }
                            className="w-16 px-2 py-1 text-center border border-[#D5CBBF] rounded bg-white text-xs font-mono"
                          />
                        ) : (
                          <span
                            className={
                              item.stock > 0
                                ? 'font-semibold text-[#0F523E]'
                                : 'font-semibold text-[#8C827A]'
                            }
                          >
                            {item.stock > 0 ? `${item.stock} in stock` : 'Sold out'}
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-xs text-[#57504A] max-w-xs truncate">
                        {item.concessions.join(' · ')}
                      </td>

                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                onClick={() => saveRowEdit(item.id)}
                                className="px-2.5 py-1 text-xs font-semibold bg-[#0F523E] text-white rounded flex items-center gap-1 cursor-pointer"
                              >
                                <Check className="w-3 h-3" />
                                <span>Save</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingRowId(null)}
                                className="px-2 py-1 text-xs text-[#665E57] hover:text-[#1E1B18] cursor-pointer"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => startEditingRow(item)}
                                className="px-2.5 py-1 text-xs font-medium border border-[#D5CBBF] rounded bg-white hover:bg-[#F3EDE4] text-[#1E1B18] cursor-pointer"
                              >
                                Edit Rules
                              </button>
                              <button
                                type="button"
                                onClick={() => onSelectItemForBargain(item.id)}
                                className="px-2.5 py-1 text-xs font-medium text-[#0070BA] hover:underline inline-flex items-center gap-1 cursor-pointer"
                              >
                                <span>Test Chat</span>
                                <ExternalLink className="w-3 h-3" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ADD NEW HANDMADE ITEM MODAL */}
      {showNewModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-item-modal-title"
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-xl border border-[#E5DDD0] max-w-lg w-full p-6 space-y-5 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#E5DDD0] pb-3">
              <h2 id="new-item-modal-title" className="font-serif text-xl font-bold text-[#1E1B18]">
                List a Handmade Item for Negotiation
              </h2>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="text-xs font-semibold text-[#665E57] hover:text-[#1E1B18] cursor-pointer"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleCreateItem} className="space-y-4">
              {modalError && (
                <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-800 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                  <span>{modalError}</span>
                </div>
              )}

              <div>
                <label
                  htmlFor="new-item-title"
                  className="block text-xs font-semibold text-[#1E1B18] mb-1"
                >
                  Product Title
                </label>
                <input
                  id="new-item-title"
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Hand-Sewn Saddle Leather Chelsea Boot"
                  className="w-full px-3 py-2 text-sm border border-[#D5CBBF] rounded-lg bg-white text-[#1E1B18]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="new-item-maker"
                    className="block text-xs font-semibold text-[#1E1B18] mb-1"
                  >
                    Maker / Studio Name
                  </label>
                  <input
                    id="new-item-maker"
                    type="text"
                    required
                    value={newSellerName}
                    onChange={(e) => setNewSellerName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D5CBBF] rounded-lg bg-white text-[#1E1B18]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="new-item-category"
                    className="block text-xs font-semibold text-[#1E1B18] mb-1"
                  >
                    Category
                  </label>
                  <select
                    id="new-item-category"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as SellerItem['category'])}
                    className="w-full px-3 py-2 text-sm border border-[#D5CBBF] rounded-lg bg-white text-[#1E1B18]"
                  >
                    <option value="Footwear">Footwear</option>
                    <option value="Leather Goods">Leather Goods</option>
                    <option value="Home & Kitchen">Home &amp; Kitchen</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="new-item-asking"
                    className="block text-xs font-semibold text-[#1E1B18] mb-1"
                  >
                    Asking Price ($)
                  </label>
                  <input
                    id="new-item-asking"
                    type="number"
                    min={1}
                    required
                    value={newAskingPrice}
                    onChange={(e) => setNewAskingPrice(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-[#D5CBBF] rounded-lg bg-white text-[#1E1B18]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="new-item-floor"
                    className="block text-xs font-semibold text-[#8B4B24] mb-1"
                  >
                    Secret Floor ($)
                  </label>
                  <input
                    id="new-item-floor"
                    type="number"
                    min={1}
                    required
                    value={newFloorPrice}
                    onChange={(e) => setNewFloorPrice(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-[#D5CBBF] rounded-lg bg-white text-[#1E1B18]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="new-item-stock"
                    className="block text-xs font-semibold text-[#1E1B18] mb-1"
                  >
                    Stock
                  </label>
                  <input
                    id="new-item-stock"
                    type="number"
                    min={0}
                    required
                    value={newStock}
                    onChange={(e) => setNewStock(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-[#D5CBBF] rounded-lg bg-white text-[#1E1B18]"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="new-item-concessions"
                  className="block text-xs font-semibold text-[#1E1B18] mb-1"
                >
                  Pre-Approved Perks (comma-separated)
                </label>
                <input
                  id="new-item-concessions"
                  type="text"
                  value={newConcessions}
                  onChange={(e) => setNewConcessions(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#D5CBBF] rounded-lg bg-white text-[#1E1B18]"
                />
              </div>

              <div>
                <label
                  htmlFor="new-item-desc"
                  className="block text-xs font-semibold text-[#1E1B18] mb-1"
                >
                  Description
                </label>
                <textarea
                  id="new-item-desc"
                  rows={2}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Describe the materials, fit, and handmade details..."
                  className="w-full px-3 py-2 text-sm border border-[#D5CBBF] rounded-lg bg-white text-[#1E1B18]"
                />
              </div>

              <div>
                <label
                  htmlFor="new-item-image"
                  className="block text-xs font-semibold text-[#1E1B18] mb-1"
                >
                  Product Photo Preset
                </label>
                <select
                  id="new-item-image"
                  value={newImageUrl}
                  onChange={(e) => setNewImageUrl(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#D5CBBF] rounded-lg bg-white text-[#1E1B18]"
                >
                  <option value="/src/assets/images/born_cognac_leather_boot_1794051636673.jpg">
                    Hand-Sewn Cognac Leather Boot
                  </option>
                  <option value="/src/assets/images/bernardo_woven_leather_sandal_1794051637892.jpg">
                    Hand-Woven Saddle Leather Sandal
                  </option>
                  <option value="/src/assets/images/saddle_leather_crossbody_tote_1794051639509.jpg">
                    Vegetable-Tanned Leather Tote
                  </option>
                  <option value="/src/assets/images/handcrafted_suede_loafer_1794051640498.jpg">
                    Espresso Suede Penny Loafer
                  </option>
                  <option value="/src/assets/images/artisan_stoneware_pour_over_1794051641641.jpg">
                    Speckled Stoneware Pour-Over Set
                  </option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E5DDD0]">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-[#57504A] hover:text-[#1E1B18] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  data-testid="submit-new-item-btn"
                  className="px-5 py-2.5 text-xs font-semibold bg-[#1E1B18] hover:bg-[#8B4B24] text-white rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {submitting && (
                    <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                  )}
                  {submitting ? 'Publishing Item...' : 'Publish Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
