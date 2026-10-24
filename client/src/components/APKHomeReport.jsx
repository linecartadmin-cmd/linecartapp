import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { OutlinedInput, OutlinedDropdown, AndroidToast } from './MaterialUI';

export default function APKHomeReport({ user }) {
  const [clustersList, setClustersList] = useState([]);
  const [selectedClusterId, setSelectedClusterId] = useState(1);
  const [selectedClusterLabel, setSelectedClusterLabel] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const toastTimerRef = useRef(null);

  const showToast = (msg) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(''), 3000);
  };

  // Current date in dd-MM-yyyy format (HomeReport.java lines 155-157)
  const todayDate = (() => {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  })();

  useEffect(() => {
    let mounted = true;
    api
      .getHomeReport(user?.id || 1)
      .then((res) => {
        if (!mounted) return;
        if ((res?.status === 200 || res?.status === 1) && res?.result?.clusterList) {
          const list = res.result.clusterList;
          setClustersList(list);
          if (list.length > 0) {
            setSelectedClusterId(list[0].clusterId);
            setSelectedClusterLabel(list[0].clusterName);
          }
        } else {
          showToast('Failed to get clusterInfo');
        }
      })
      .catch(() => {
        if (mounted) showToast('Failed to get clusterInfo');
      });
    return () => {
      mounted = false;
    };
  }, [user?.id]);

  // Match HomeReport.java updateReportData(clusterId)
  const activeCluster =
    clustersList.find((c) => Number(c.clusterId) === Number(selectedClusterId)) ||
    clustersList[0] ||
    null;

  const deliveryStatusList = activeCluster?.deliverystatus || activeCluster?.delivery_status || [];
  const orderItemStatusList = activeCluster?.order_item_status || [];

  const shopStatus = activeCluster?.order_shop_status || activeCluster || {};
  const totalShops = shopStatus.totalshops ?? activeCluster?.totalshops ?? 0;
  const totalOrderedShops = shopStatus.totalorderedshops ?? activeCluster?.totalorderedshops ?? 0;
  const totalNotOrderedShops = shopStatus.totalnotorderedshops ?? activeCluster?.totalnotorderedshops ?? 0;

  // Exact 4 rows constructed in HomeReport.java lines 294-297 (including "Sops" spelling)
  const shopStatusRows = activeCluster
    ? [
        { name: 'Total Number Of Shops', totalcount: totalShops },
        { name: 'Number Of Ordered Shops', totalcount: totalOrderedShops },
        { name: 'Number Of Not Ordered Shops', totalcount: totalNotOrderedShops },
        { name: 'Number Of Sops Not Connected', totalcount: totalNotOrderedShops }
      ]
    : [];

  const clusterOptions = clustersList.map((c) => ({
    value: c.clusterId,
    label: c.clusterName
  }));

  return (
    <div className="w-full min-h-full flex flex-col bg-[#19afe6] text-[#1c1b1f] select-none">
      {/* Top LinearLayout (#00aae6, padding 16dp) matching fragment_home_reports.xml lines 8-58 */}
      <div className="bg-[#00aae6] p-4 space-y-3">
        <h2
          id="formtitlesum"
          className="text-[25px] font-bold font-serif text-[#f7ef02] leading-tight"
        >
          Summary Report
        </h2>

        {/* Date OutlinedBox (@+id/outlined_text_input_layoutRDate -> @+id/cdateHR) */}
        <OutlinedInput
          id="cdateHR"
          label="Date"
          value={todayDate}
          readOnly
          bgColor="#00aae6"
        />

        {/* Cluster OutlinedDropdown (@+id/clusteridlayoutHR -> @+id/clusteridspinnerHR) */}
        <OutlinedDropdown
          id="clusteridspinnerHR"
          label="Cluster"
          value={selectedClusterLabel || activeCluster?.clusterName || ''}
          options={clusterOptions}
          onChange={(opt) => {
            setSelectedClusterId(opt.value);
            setSelectedClusterLabel(opt.label);
          }}
          bgColor="#00aae6"
        />
      </div>

      {/* ScrollView body (#19afe6, padding 16dp) matching fragment_home_reports.xml lines 59-135 */}
      <div className="flex-1 bg-[#19afe6] p-4 pb-8">
        {/* Section 1: Delivery Status Summary */}
        <h3 id="ordstatustbl" className="text-[25px] font-bold text-[#1c1b1f] mb-1">
          Delivery Status Summary
        </h3>

        {/* Yellow Table Header (#f7ef02, height 50dp) */}
        <div className="bg-[#f7ef02] h-[50px] px-4 flex items-center text-[16px] font-bold text-[#1c1b1f]">
          <div className="flex-1 min-w-[100px] text-left">Item Name</div>
          <div className="w-[70px] text-left">Total</div>
          <div className="w-[90px] text-left">Delivered</div>
          <div className="w-[90px] text-left">Inprogress</div>
        </div>

        {/* deliverystatusRecyclerView -> hr_deliverystatus.xml (#f0f7f7, padding 16dp, marginBottom 5dp) */}
        <div className="space-y-[5px]">
          {deliveryStatusList.map((dstatus, idx) => (
            <div
              key={`${dstatus.id || idx}-${dstatus.name}`}
              className="bg-[#f0f7f7] p-4 flex items-center text-[16px] text-[#1c1b1f]"
            >
              <div className="flex-1 min-w-[100px] font-bold pr-2">{dstatus.name}</div>
              <div className="w-[70px] font-normal">{dstatus.totalcount}</div>
              {/* Hardcoded "11" and "22" in HR_DeliveryStatus_LinearAdapter.java lines 56-57 */}
              <div className="w-[90px] font-normal">11</div>
              <div className="w-[90px] font-normal">22</div>
            </div>
          ))}
        </div>

        {/* Section 2: Shop Status Summary */}
        <h3 id="shpstatustbl" className="text-[25px] font-bold text-[#1c1b1f] mt-5 mb-1">
          Shop Status Summary
        </h3>

        {/* ordersstatusRecyclerView -> hr_orderstatus.xml (#f7ef02, padding 16dp, marginBottom 10dp) */}
        <div className="space-y-[10px]">
          {shopStatusRows.map((row, idx) => (
            <div
              key={idx}
              className="bg-[#f7ef02] p-4 flex items-center text-[16px] font-bold text-[#1c1b1f]"
            >
              <div className="w-[240px] sm:w-[280px] pr-2">{row.name}</div>
              <div className="flex-1">{row.totalcount}</div>
            </div>
          ))}
        </div>

        {/* Section 3: Item Orders Status Summary */}
        <h3 id="oitemstatustbl" className="text-[25px] font-bold text-[#1c1b1f] mt-5 mb-1">
          Item Orders Status Summary
        </h3>

        {/* itemordersstatusRecyclerView -> hr_orderstatus.xml (#f7ef02, padding 16dp, marginBottom 10dp) */}
        <div className="space-y-[10px]">
          {orderItemStatusList.map((item, idx) => (
            <div
              key={`${item.id || idx}-${item.name}`}
              className="bg-[#f7ef02] p-4 flex items-center text-[16px] font-bold text-[#1c1b1f]"
            >
              <div className="w-[240px] sm:w-[280px] pr-2">{item.name}</div>
              <div className="flex-1">{item.totalcount}</div>
            </div>
          ))}
        </div>
      </div>

      <AndroidToast message={toastMsg} />
    </div>
  );
}
