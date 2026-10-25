import React, { useState } from 'react';
import { ArrowLeft, Store, MapPin, Phone, User, CheckCircle, AlertCircle, Compass } from 'lucide-react';
import { api } from '../api';

export default function RegisterShop({ defaultClusterId, user, onBack, onRegistered }) {
  const [formData, setFormData] = useState({
    shopName: '',
    shopCategory: 'General Grocery',
    ownerName: '',
    contact1: '',
    contact2: '',
    clusterid: defaultClusterId || 101,
    address: '',
    pincode: '',
    latitude: 12.9716,
    longitude: 77.5946,
    paymentmode: 1,
    createdby: user.id
  });

  const [loadingLoc, setLoadingLoc] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const fetchCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser');
      return;
    }
    setLoadingLoc(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        setFormData((prev) => ({ ...prev, latitude: lat, longitude: lon }));

        // Optional reverse geocode with OpenStreetMap Nominatim
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
          const geo = await res.json();
          if (geo && geo.display_name) {
            setFormData((prev) => ({
              ...prev,
              address: geo.display_name,
              pincode: geo.address?.postcode || prev.pincode
            }));
          }
        } catch (e) {
          console.warn('Geocoding failed, using coordinates only');
        } finally {
          setLoadingLoc(false);
        }
      },
      (err) => {
        setLoadingLoc(false);
        alert('Could not retrieve GPS location: ' + err.message);
      }
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const resp = await api.addCustomer(formData);
      if (resp.status === 1) {
        setSuccess(resp.message || 'Store registered successfully!');
        setTimeout(() => {
          onRegistered();
        }, 1600);
      } else {
        setError(resp.message || 'Failed to register store');
      }
    } catch (err) {
      setError('Connection to API server failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          title="Go back"
          aria-label="Go back"
          className="w-10 h-10 min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 rounded-xl border border-slate-200 transition"
        >
          <ArrowLeft className="w-5 h-5" aria-hidden="true" />
          <span className="sr-only">Go back</span>
        </button>
        <div>
          <h2 className="text-xl font-bold text-slate-800">Register New Retail Store</h2>
          <p className="text-xs text-slate-500">Onboard a retail client with GPS geolocation and contact info</p>
        </div>
      </div>

      {success && (
        <div className="p-4 bg-emerald-50 border-l-4 border-emerald-500 text-emerald-800 rounded-xl text-sm flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border-l-4 border-red-500 text-red-800 rounded-xl text-sm flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
              Store / Shop Name *
            </label>
            <div className="relative">
              <Store className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                required
                value={formData.shopName}
                onChange={(e) => setFormData({ ...formData, shopName: e.target.value })}
                placeholder="e.g. Balaji Provisions"
                className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
              Category
            </label>
            <select
              value={formData.shopCategory}
              onChange={(e) => setFormData({ ...formData, shopCategory: e.target.value })}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white text-sm"
            >
              <option value="General Grocery">General Grocery</option>
              <option value="Supermarket">Supermarket</option>
              <option value="Wholesale Distributor">Wholesale Distributor</option>
              <option value="Convenience Store">Convenience Store</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
              Owner / Contact Person
            </label>
            <div className="relative">
              <User className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={formData.ownerName}
                onChange={(e) => setFormData({ ...formData, ownerName: e.target.value })}
                placeholder="e.g. Ramesh Patel"
                className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
              Primary Phone (Contact 1) *
            </label>
            <div className="relative">
              <Phone className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="tel"
                required
                value={formData.contact1}
                onChange={(e) => setFormData({ ...formData, contact1: e.target.value })}
                placeholder="10-digit number"
                className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white text-sm"
              />
            </div>
          </div>
        </div>

        {/* GPS Section */}
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-emerald-600" />
              GPS Coordinates & Address
            </span>
            <button
              type="button"
              onClick={fetchCurrentLocation}
              disabled={loadingLoc}
              className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-100 hover:bg-emerald-200 px-3 py-1.5 rounded-lg transition"
            >
              <Compass className={`w-3.5 h-3.5 ${loadingLoc ? 'animate-spin' : ''}`} />
              <span>{loadingLoc ? 'Detecting...' : 'Auto-Detect GPS'}</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-slate-500">Latitude:</span>
              <input
                type="number"
                step="any"
                value={formData.latitude}
                onChange={(e) => setFormData({ ...formData, latitude: parseFloat(e.target.value) || 0 })}
                className="w-full mt-1 p-2 bg-white border border-slate-200 rounded-lg text-slate-800 font-mono"
              />
            </div>
            <div>
              <span className="text-slate-500">Longitude:</span>
              <input
                type="number"
                step="any"
                value={formData.longitude}
                onChange={(e) => setFormData({ ...formData, longitude: parseFloat(e.target.value) || 0 })}
                className="w-full mt-1 p-2 bg-white border border-slate-200 rounded-lg text-slate-800 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-600 mb-1">Street Address</label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              placeholder="Store address / landmark"
              className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onBack}
            className="px-5 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium rounded-xl text-sm transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-sm shadow-md shadow-emerald-600/20 transition flex items-center gap-2"
          >
            {submitting ? 'Registering...' : 'Save & Register Store'}
          </button>
        </div>
      </form>
    </div>
  );
}
