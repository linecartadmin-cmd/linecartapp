import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { OutlinedInput, OutlinedDropdown, AndroidToast } from './MaterialUI';

// Exact arrays from decompiled/resources/res/values/arrays.xml
const SHOP_CATEGORIES = ['Retail', 'SuperMarket', 'HoReCa', 'ChainRetail', 'FruitShop'];
const PAYMENT_MODES = ['Online', 'Cash'];

export default function APKRegistration({ user }) {
  const [clustersList, setClustersList] = useState([]);
  const [selectedCluster, setSelectedCluster] = useState(0);
  const [selectedClusterLabel, setSelectedClusterLabel] = useState('');

  const [sname, setSname] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(0);
  const [selectedCategoryLabel, setSelectedCategoryLabel] = useState('');

  const [vname, setVname] = useState('');
  const [vcontact, setVcontact] = useState('');
  const [vcontact2, setVcontact2] = useState('');

  const [selectedPayMode, setSelectedPayMode] = useState(0);
  const [selectedPayModeLabel, setSelectedPayModeLabel] = useState('');

  // Default map coordinates (Pollachi / Tamil Nadu region matching cluster 1)
  const [latitude, setLatitude] = useState('10.658300');
  const [longitude, setLongitude] = useState('77.008200');
  const [saddress, setSaddress] = useState('');
  const [spincode, setSpincode] = useState('');

  const [surveyItems, setSurveyItems] = useState([]);
  // Registration.java line 105: this.isphotouploaded = true initially, resets to false after first submit
  const [isPhotoUploaded, setIsPhotoUploaded] = useState(true);
  const [photoPreview, setPhotoPreview] = useState('/no_image.jpg');
  const [photoFile, setPhotoFile] = useState(null);

  const [loading, setLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const toastTimerRef = useRef(null);
  const fileInputRef = useRef(null);

  const showToast = (msg) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(''), 3000);
  };

  // Reverse geocode via Nominatim (matching Registration.java getAddressFromLocation lines 417-457)
  const fetchAddressFromNominatim = async (lat, lon) => {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=27&addressdetails=1`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) {
        showToast('Address Not Available');
        return;
      }
      const data = await res.json();
      if (data?.display_name) {
        setSaddress(data.display_name);
        if (data?.address?.postcode) {
          setSpincode(data.address.postcode);
        }
      } else {
        showToast('Address Not Available');
      }
    } catch {
      showToast('Address Not Available');
    }
  };

  // Load cluster info and initialize survey items for cluster 1 (matching Registration.java lines 284-315)
  useEffect(() => {
    let mounted = true;
    api
      .getClusterInfo(user?.id || 1)
      .then((res) => {
        if (!mounted) return;
        if ((res?.status === 200 || res?.status === 1) && res?.result?.clusterList) {
          const list = res.result.clusterList;
          setClustersList(list);
          // Registration.java line 292: updateSurveyItemData(1)
          const firstCluster = list.find((c) => Number(c.clusterId) === 1) || list[0];
          if (firstCluster?.surveyItemsList) {
            setSurveyItems(
              firstCluster.surveyItemsList.map((item) => ({
                itemid: item.itemid,
                itemName: item.itemName,
                value: ''
              }))
            );
          }
        } else {
          showToast('Failed to get clusterInfo.');
        }
      })
      .catch(() => {
        if (mounted) showToast('Failed to get clusterInfo.');
      });

    // Trigger initial reverse geocode for default coordinates
    fetchAddressFromNominatim(10.6583, 77.0082);

    return () => {
      mounted = false;
    };
  }, [user?.id]);

  const updateSurveyItemData = (clusterId) => {
    const found = clustersList.find((c) => Number(c.clusterId) === Number(clusterId));
    if (found?.surveyItemsList) {
      setSurveyItems(
        found.surveyItemsList.map((item) => ({
          itemid: item.itemid,
          itemName: item.itemName,
          value: ''
        }))
      );
    }
  };

  const handleMapLocateClick = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude.toFixed(6);
          const lon = pos.coords.longitude.toFixed(6);
          setLatitude(String(lat));
          setLongitude(String(lon));
          fetchAddressFromNominatim(lat, lon);
        },
        () => {
          // Fallback if browser permission denied
          const lat = (10.6583 + (Math.random() - 0.5) * 0.01).toFixed(6);
          const lon = (77.0082 + (Math.random() - 0.5) * 0.01).toFixed(6);
          setLatitude(String(lat));
          setLongitude(String(lon));
          fetchAddressFromNominatim(lat, lon);
        }
      );
    }
  };

  const handleMapCanvasClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width - 0.5;
    const relY = 0.5 - (e.clientY - rect.top) / rect.height;
    const baseLat = parseFloat(latitude) || 10.6583;
    const baseLon = parseFloat(longitude) || 77.0082;
    const newLat = (baseLat + relY * 0.008).toFixed(6);
    const newLon = (baseLon + relX * 0.008).toFixed(6);
    setLatitude(String(newLat));
    setLongitude(String(newLon));
    fetchAddressFromNominatim(newLat, newLon);
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFile(file);
      setIsPhotoUploaded(true);
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setPhotoPreview(reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Exact validation and submission sequence from Registration.java lines 505-591
  const handleSubmit = async (e) => {
    if (e) e.preventDefault();

    if (selectedCluster === 0) {
      showToast('Please Select Valid Cluster.');
      return;
    }
    if (sname.trim().length === 0) {
      showToast('Please Enter Valid Shop Name.');
      return;
    }
    if (vname.trim().length === 0) {
      showToast('Please Enter Valid Owner Name.');
      return;
    }
    if (vcontact.trim().length === 0) {
      showToast('Please Enter Valid Contact Number1.');
      return;
    }
    if (latitude.trim().length === 0 || longitude.trim().length === 0) {
      showToast('Invalid Location Lat/Long Please Enable Location Services.');
      return;
    }
    if (saddress.trim().length === 0) {
      showToast('Please Enter Valid Address.');
      return;
    }
    if (spincode.trim().length === 0) {
      showToast('Please Enter Valid Pincode.');
      return;
    }
    if (!isPhotoUploaded) {
      showToast('Please Capture Shop Photo');
      return;
    }

    const itemsReqList = surveyItems.map((it) => ({
      itemid: it.itemid,
      qty: parseFloat(it.value) || 0.0
    }));

    const customerData = {
      clusterid: selectedCluster,
      shopName: sname.trim(),
      shopCategory: String(selectedCategory),
      ownerName: vname.trim(),
      contact1: vcontact.trim(),
      contact2: vcontact2.trim(),
      latitude: parseFloat(latitude) || 0.0,
      longitude: parseFloat(longitude) || 0.0,
      address: saddress.trim(),
      pincode: spincode.trim(),
      paymentmode: selectedPayMode,
      createdby: Number(user?.id || localStorage.getItem('LineCartPref_userid') || 1),
      itemsReqList
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      showToast('Shop registration requires an active internet connection.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.addCustomer(customerData, photoFile);
      if (res && (res.status === 200 || res.status === 1)) {
        showToast('Customer Created Successfully');
        // Exact state reset from Registration.java lines 570-576
        setSname('');
        setVname('');
        setVcontact('');
        setVcontact2('');
        setPhotoPreview('/no_image.jpg');
        setPhotoFile(null);
        setIsPhotoUploaded(false);
      } else {
        showToast('Failed to create Customer.');
      }
    } catch {
      showToast('Failed to create Customer.');
    } finally {
      setLoading(false);
    }
  };

  const clusterOptions = clustersList.map((c) => ({
    value: c.clusterId,
    label: c.clusterName
  }));

  const categoryOptions = SHOP_CATEGORIES.map((cat, idx) => ({
    value: idx,
    label: cat
  }));

  const paymentOptions = PAYMENT_MODES.map((mode, idx) => ({
    value: idx,
    label: mode
  }));

  return (
    <div className="w-full min-h-full bg-[#19afe6] p-4 pb-20 select-none">
      {/* Title (@+id/formtitle) */}
      <h2
        id="formtitle"
        className="text-[25px] font-bold font-serif text-[#f7ef02] mb-2 leading-tight"
      >
        Customer Registration
      </h2>

      <form onSubmit={handleSubmit} method="POST" action="/addcustomer" noValidate className="space-y-[10px]">
        {/* 1. Cluster (@+id/clusteridlayout -> @+id/clusteridspinner) */}
        <OutlinedDropdown
          id="clusteridspinner"
          label="Cluster"
          value={selectedClusterLabel}
          options={clusterOptions}
          onChange={(opt) => {
            setSelectedCluster(opt.value);
            setSelectedClusterLabel(opt.label);
            updateSurveyItemData(opt.value);
          }}
          bgColor="#19afe6"
        />

        {/* 2. Shop Name (@+id/sname) */}
        <OutlinedInput
          id="sname"
          name="shopName"
          label="Shop Name"
          value={sname}
          onChange={(e) => setSname(e.target.value)}
          maxLength={50}
          bgColor="#19afe6"
        />

        {/* 3. Shop Category (@+id/scategorylayout -> @+id/shopcategory) */}
        <OutlinedDropdown
          id="shopcategory"
          label="Shop Category"
          value={selectedCategoryLabel}
          options={categoryOptions}
          onChange={(opt) => {
            setSelectedCategory(opt.value);
            setSelectedCategoryLabel(opt.label);
          }}
          bgColor="#19afe6"
        />

        {/* 4. Owner Name (@+id/vname) */}
        <OutlinedInput
          id="vname"
          name="ownerName"
          label="Owner Name"
          value={vname}
          onChange={(e) => setVname(e.target.value)}
          maxLength={50}
          bgColor="#19afe6"
        />

        {/* 5. Contact Number1 (@+id/vcontact) */}
        <OutlinedInput
          id="vcontact"
          name="contact1"
          label="Contact Number1"
          type="tel"
          inputMode="numeric"
          maxLength={13}
          value={vcontact}
          onChange={(e) => setVcontact(e.target.value)}
          bgColor="#19afe6"
        />

        {/* 6. Contact Number2 (@+id/vcontact2) */}
        <OutlinedInput
          id="vcontact2"
          name="contact2"
          label="Contact Number2"
          type="tel"
          inputMode="numeric"
          maxLength={13}
          value={vcontact2}
          onChange={(e) => setVcontact2(e.target.value)}
          bgColor="#19afe6"
        />

        {/* 7. ModeOfPayment (@+id/paymentlayout -> @+id/paymentmodespinner) */}
        <OutlinedDropdown
          id="paymentmodespinner"
          label="ModeOfPayment"
          value={selectedPayModeLabel}
          options={paymentOptions}
          onChange={(opt) => {
            setSelectedPayMode(opt.value);
            setSelectedPayModeLabel(opt.label);
          }}
          bgColor="#19afe6"
        />

        {/* 8. SupportMapFragment (@+id/map, 350dp x 350dp centered) */}
        <div className="pt-1 flex justify-center">
          <div
            onClick={handleMapCanvasClick}
            title="Click anywhere on map to move Shop Location marker and reverse-geocode address"
            className="w-[340px] h-[340px] sm:w-[350px] sm:h-[350px] bg-[#e8e4d8] relative overflow-hidden cursor-crosshair shadow border border-black/20"
          >
            {/* OpenStreetMap embedded iframe background + interactive click overlay */}
            <iframe
              title="Shop Location Map"
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${
                (parseFloat(longitude) || 77.0082) - 0.005
              }%2C${(parseFloat(latitude) || 10.6583) - 0.005}%2C${
                (parseFloat(longitude) || 77.0082) + 0.005
              }%2C${(parseFloat(latitude) || 10.6583) + 0.005}&layer=mapnik`}
              className="w-full h-full pointer-events-none border-0"
            />

            {/* Top-Right MyLocation Button matching GoogleMap UI in apk_reg_top.png */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleMapLocateClick();
              }}
              title="My Location"
              className="absolute top-3 right-3 w-10 h-10 bg-white/95 hover:bg-white rounded-sm shadow-md flex items-center justify-center text-[#555] z-20"
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3c-.46-4.17-3.77-7.48-7.94-7.94V1h-2v2.06C6.83 3.52 3.52 6.83 3.06 11H1v2h2.06c.46 4.17 3.77 7.48 7.94 7.94V23h2v-2.06c4.17-.46 7.48-3.77 7.94-7.94H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z" />
              </svg>
            </button>

            {/* Center Red Pin Marker ("Shop Location") */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full pointer-events-none z-10 flex flex-col items-center">
              <span className="bg-white/90 text-[#1c1b1f] text-[10px] font-bold px-1.5 py-0.5 rounded shadow mb-0.5">
                Shop Location
              </span>
              <svg className="w-8 h-8 text-red-600 drop-shadow-md" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
              </svg>
            </div>

            {/* Google watermark label matching bottom-left of SupportMapFragment */}
            <div className="absolute bottom-1.5 left-2 text-[11px] font-semibold text-slate-600/80 bg-white/70 px-1 rounded pointer-events-none">
              Tap map to set Lat/Long
            </div>
          </div>
        </div>

        {/* 9. Latitude (@+id/latitude, read-only) */}
        <OutlinedInput
          id="latitude"
          name="latitude"
          label="Latitude"
          value={latitude}
          readOnly
          bgColor="#19afe6"
        />

        {/* 10. Longitude (@+id/logitude, read-only) */}
        <OutlinedInput
          id="logitude"
          name="longitude"
          label="Longitude"
          value={longitude}
          readOnly
          bgColor="#19afe6"
        />

        {/* 11. Address (@+id/saddress, multiline 8 lines) */}
        <OutlinedInput
          id="saddress"
          name="address"
          label="Address"
          value={saddress}
          onChange={(e) => setSaddress(e.target.value)}
          multiline
          rows={4}
          maxLength={250}
          bgColor="#19afe6"
        />

        {/* 12. PinCode (@+id/spincode) */}
        <OutlinedInput
          id="spincode"
          name="pincode"
          label="PinCode"
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={spincode}
          onChange={(e) => setSpincode(e.target.value)}
          bgColor="#19afe6"
        />

        {/* 13. Weekly Req In Units (@+id/weeklyreqtitle + @+id/surveyRecyclerView) */}
        <div className="pt-2">
          <h3
            id="weeklyreqtitle"
            className="text-[25px] font-bold text-[#f7ef02] mb-3 leading-tight"
          >
            Weekly Req In Units
          </h3>

          <div className="space-y-3 bg-[#19afe6]">
            {surveyItems.map((item, idx) => (
              <OutlinedInput
                key={item.itemid || idx}
                id={`survey_item_${item.itemid || idx}`}
                label={item.itemName}
                type="text"
                inputMode="decimal"
                maxLength={6}
                value={item.value}
                onChange={(e) => {
                  const val = e.target.value;
                  setSurveyItems((prev) =>
                    prev.map((s, i) => (i === idx ? { ...s, value: val } : s))
                  );
                }}
                bgColor="#19afe6"
              />
            ))}
          </div>
        </div>

        {/* 14. Click Image To Capture Shop Photo (@+id/cameratitle + @+id/myImageView) */}
        <div className="pt-3">
          <h3
            id="cameratitle"
            className="text-[25px] font-bold text-[#f7ef02] mb-3 leading-tight"
          >
            Click Image To Capture Shop Photo
          </h3>

          <div className="flex justify-center my-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoChange}
              className="hidden"
            />
            <img
              id="myImageView"
              src={photoPreview}
              alt="Shop Photo Preview"
              onClick={() => fileInputRef.current?.click()}
              className="w-[200px] h-[200px] object-cover bg-white cursor-pointer shadow-md border border-black/15"
            />
          </div>
        </div>

        {/* 15. ProgressBar (@+id/regloading) & Submit Button (@+id/createcustomerbtn) */}
        {loading && (
          <div className="flex justify-center py-2" role="status" aria-label="Submitting">
            <div className="w-9 h-9 border-4 border-[#f7ef02] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        <div className="pt-3 pb-10 flex justify-center">
          <button
            id="createcustomerbtn"
            type="submit"
            disabled={loading}
            className="bg-[#212121] hover:bg-[#303030] active:bg-[#111111] text-white font-bold text-[14px] uppercase tracking-wider px-8 py-2.5 rounded-full shadow-md transition disabled:opacity-60"
          >
            SUBMIT
          </button>
        </div>
      </form>

      <AndroidToast message={toastMsg} />
    </div>
  );
}
