import React, { useState } from 'react';

export default function APKOrderReports() {
  const [activeBtn, setActiveBtn] = useState('TODAY');
  const [shopId1, setShopId1] = useState('560049_1');
  const [shopName1, setShopName1] = useState('SLV Vegies');
  const [shopId2, setShopId2] = useState('560049_2');
  const [shopName2, setShopName2] = useState('Moksha Vegies');

  return (
    <div className="w-full min-h-full bg-[#fffbfe] flex flex-col select-none">
      {/* Top 80dp margin area matching fragment_order_reports.xml android:layout_marginTop="80dp" */}
      <div className="h-[60px] sm:h-[80px] bg-[#fffbfe] flex-shrink-0" />

      {/* ScrollView body (#00aae6) matching fragment_order_reports.xml */}
      <div className="flex-1 bg-[#00aae6] text-white px-2.5 pt-2 pb-16">
        {/* Horizontal LinearLayout with 3 dark pill buttons: TODAY, 19-09-2026, 18-09-2026 */}
        <div className="flex items-center gap-3 mb-10 flex-wrap">
          <button
            id="todaybtn"
            type="button"
            onClick={() => setActiveBtn('TODAY')}
            className={`bg-[#212121] hover:bg-[#303030] text-white font-bold text-[13px] uppercase px-5 py-2.5 rounded-full shadow transition ${
              activeBtn === 'TODAY' ? 'ring-2 ring-[#f7ef02]' : ''
            }`}
          >
            TODAY
          </button>

          <button
            id="ydaybtn"
            type="button"
            onClick={() => setActiveBtn('19-09-2026')}
            className={`bg-[#212121] hover:bg-[#303030] text-white font-bold text-[13px] uppercase px-5 py-2.5 rounded-full shadow transition ${
              activeBtn === '19-09-2026' ? 'ring-2 ring-[#f7ef02]' : ''
            }`}
          >
            19-09-2026
          </button>

          <button
            id="dydaybtn"
            type="button"
            onClick={() => setActiveBtn('18-09-2026')}
            className={`bg-[#212121] hover:bg-[#303030] text-white font-bold text-[13px] uppercase px-5 py-2.5 rounded-full shadow transition ${
              activeBtn === '18-09-2026' ? 'ring-2 ring-[#f7ef02]' : ''
            }`}
          >
            18-09-2026
          </button>
        </div>

        {/* Store 1 Block: 560049_1 / SLV Vegies */}
        <div className="space-y-1 mb-6">
          <div className="flex items-baseline">
            <span className="w-[155px] text-[24px] sm:text-[26px] font-normal text-white">
              ShopID
            </span>
            <input
              id="ShopID"
              type="text"
              value={shopId1}
              onChange={(e) => setShopId1(e.target.value)}
              aria-label="ShopID 1"
              className="w-[190px] bg-transparent text-white text-[24px] sm:text-[26px] border-b border-black/60 pb-0.5 outline-none"
            />
          </div>

          <div className="flex items-baseline">
            <span className="w-[155px] text-[24px] sm:text-[26px] font-normal text-white">
              ShopName
            </span>
            <input
              id="ShopName"
              type="text"
              value={shopName1}
              onChange={(e) => setShopName1(e.target.value)}
              aria-label="ShopName 1"
              className="w-[190px] bg-transparent text-white text-[24px] sm:text-[26px] border-b border-black/60 pb-0.5 outline-none"
            />
          </div>

          {/* Table 1 */}
          <div className="pt-1 text-[17px] sm:text-[19px] leading-snug">
            <div className="grid grid-cols-12 gap-1 font-normal text-white pb-1">
              <div className="col-span-4">Item</div>
              <div className="col-span-2">QTY</div>
              <div className="col-span-2">Amount</div>
              <div className="col-span-4">Delivary Status</div>
            </div>

            <div className="grid grid-cols-12 gap-1 text-white py-0.5">
              <div className="col-span-4">Onion</div>
              <div className="col-span-2">20</div>
              <div className="col-span-2">1200</div>
              <div className="col-span-4">Delivered</div>
            </div>

            <div className="grid grid-cols-12 gap-1 text-white py-0.5">
              <div className="col-span-4">Potato</div>
              <div className="col-span-2">10</div>
              <div className="col-span-2">3400</div>
              <div className="col-span-4">Ordered</div>
            </div>

            <div className="grid grid-cols-12 gap-1 text-white py-0.5">
              <div className="col-span-4">Banana Robusta</div>
              <div className="col-span-2">0</div>
              <div className="col-span-2">0</div>
              <div className="col-span-4">Not Ordered</div>
            </div>
          </div>
        </div>

        {/* Store 2 Block: 560049_2 / Moksha Vegies */}
        <div className="space-y-1">
          <div className="flex items-baseline">
            <span className="w-[155px] text-[24px] sm:text-[26px] font-normal text-white">
              ShopID
            </span>
            <input
              id="ShopID1"
              type="text"
              value={shopId2}
              onChange={(e) => setShopId2(e.target.value)}
              aria-label="ShopID 2"
              className="w-[190px] bg-transparent text-white text-[24px] sm:text-[26px] border-b border-black/60 pb-0.5 outline-none"
            />
          </div>

          <div className="flex items-baseline">
            <span className="w-[155px] text-[24px] sm:text-[26px] font-normal text-white">
              ShopName
            </span>
            <input
              id="ShopName1"
              type="text"
              value={shopName2}
              onChange={(e) => setShopName2(e.target.value)}
              aria-label="ShopName 2"
              className="w-[190px] bg-transparent text-white text-[24px] sm:text-[26px] border-b border-black/60 pb-0.5 outline-none"
            />
          </div>

          {/* Table 2 */}
          <div className="pt-1 text-[17px] sm:text-[19px] leading-snug">
            <div className="grid grid-cols-12 gap-1 font-normal text-white pb-1">
              <div className="col-span-4">Item</div>
              <div className="col-span-2">QTY</div>
              <div className="col-span-2">Amount</div>
              <div className="col-span-4">Delivary Status</div>
            </div>

            <div className="grid grid-cols-12 gap-1 text-white py-0.5">
              <div className="col-span-4">Onion</div>
              <div className="col-span-2">NA</div>
              <div className="col-span-2">NA</div>
              <div className="col-span-4">OrderNotPlaced</div>
            </div>

            <div className="grid grid-cols-12 gap-1 text-white py-0.5">
              <div className="col-span-4">Tomato Hybrid</div>
              <div className="col-span-2">NA</div>
              <div className="col-span-2">NA</div>
              <div className="col-span-4">OrderNotPlaced</div>
            </div>

            <div className="grid grid-cols-12 gap-1 text-white py-0.5">
              <div className="col-span-4">Banana Elaki</div>
              <div className="col-span-2">NA</div>
              <div className="col-span-2">NA</div>
              <div className="col-span-4">OrderNotPlaced</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
