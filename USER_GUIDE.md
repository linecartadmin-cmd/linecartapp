# LineCart Web Recreation — User Guide

This document provides setup instructions, credential details, and step-by-step instructions for every workflow in the **LineCart** web application (`com.dalavai.linecart`, version `1.0`).

---

## 1. Setup & Access Instructions

### Prerequisites
- **Node.js** (v18+ recommended) and **npm**

### Starting the Application
From the workspace root (`C:\Users\samma\Desktop\rea`):

```powershell
# 1. Install dependencies (if not already installed)
npm --prefix linecart-suite/server install
npm --prefix linecart-suite/client install

# 2. Build the production React frontend
npm --prefix linecart-suite/client run build

# 3. Start the Express backend & static web server on port 3001
node linecart-suite/server/index.js
```

- **Application URL:** `http://localhost:3001`
- **Development Hot-Reload Mode (Optional):** Run `npm --prefix linecart-suite/client run dev` to launch Vite on `http://localhost:3000` (proxies API calls to `http://localhost:3001`).

### Top Browser Utility Bar
Because the original Android APK has no logout button inside `MainMenu` and is designed for portrait mobile screens, the website includes a thin outer utility bar at the top of the browser viewport:
- **`LineCartPref.userid` Badge:** Displays the persisted session ID stored in `localStorage` (mirroring Android's `SharedPreferences("LineCartPref", 0)`).
- **`Desktop Width` / `Phone Viewport` Button:** Toggles the container between a `412px` mobile portrait viewport and a wide responsive desktop container.
- **`Splash` Button:** Re-triggers the 2-second `Loading` splash screen (`res/layout/loading.xml`).
- **`Reset Session` Button:** Clears `LineCartPref_userid` back to `"0"` and returns to the `Login` screen.

---

## 2. Demo Credentials (Local Backend)

The live remote server (`http://freshcubes.in/admin_panel/public/api/linecart/login`) was verified to return `status: 400 ("Invalid credentials")` when tested without a production sales officer account. The local Express backend (`server/index.js`) implements the exact `POST /login?phone=...&password=...` contract (`status: 200` on success, `status: 400` on invalid credentials) using the following demo accounts:

| User Role | UserId (`phone`) | Password (`password`) | `spersonId` (`id`) |
| :--- | :--- | :--- | :--- |
| **Field Sales Officer (Primary)** | `9876543210` | `1234` (or `password123`) | `1` |
| **Field Sales Officer (Secondary)** | `9845012345` | `1234` | `2` |

> **Tip:** On the `Login` screen, you can also click the **"Fill 9876543210 / 1234"** helper button below the form to populate the credentials automatically, or click **"Test Invalid UserId"** to test the validation Toast.

---

## 3. Step-by-Step Workflows

### Workflow 1: Splash Screen (`Loading`) & Session Check
1. Open `http://localhost:3001` (or click **Splash** in the top utility bar).
2. The app displays the `#00aae6` splash screen with the centered `150px × 150px` LineCart logo (`lincart_flashicon.png`) for **2,000 ms**.
3. After 2 seconds:
   - If `LineCartPref_userid` is `"0"` (not signed in), the app navigates to the **Login** screen.
   - If `LineCartPref_userid` is non-`"0"`, the app skips Login and opens **MainMenu** on the **Home** tab.

![Loading Splash Screen](docs/screenshots/01_loading_splash.png)

---

### Workflow 2: Sign-In (`Login`) & Input Validation
1. On the **Login** screen (`#19afe6` background), observe the two yellow-bordered Material OutlinedBox fields (`UserId` and `Password`) and the dark charcoal **LOGIN** button.
2. **Validation checks (matching `Login.java`):**
   - Leave `UserId` empty or enter fewer/more than 10 digits (e.g., `123`) and click **LOGIN** $\rightarrow$ An Android Toast appears at the bottom: `"Please Enter Valid UserId."`
   - Enter a 10-digit `UserId` (`9876543210`), leave `Password` empty, and click **LOGIN** $\rightarrow$ An Android Toast appears: `"Please Enter Valid Password."`
   - Enter `9876543210` and an invalid password (e.g., `wrong`) and click **LOGIN** $\rightarrow$ An Android Toast appears: `"Invalid UserId/Password."`
3. **Valid Sign-In:**
   - Enter `UserId`: `9876543210` and `Password`: `1234`.
   - Click **LOGIN**.
   - A circular progress spinner (`@+id/loading`) appears briefly while calling `POST /login`.
   - Upon receiving `status: 200`, the app saves `result[0].id` (`"1"`) to `LineCartPref` and opens **MainMenu** on the **Home** tab.

| Empty Login Screen | Validation Toast | Filled Credentials |
| :---: | :---: | :---: |
| ![Login Empty](docs/screenshots/02_login_empty.png) | ![Login Toast](docs/screenshots/03_login_validation_toast.png) | ![Login Filled](docs/screenshots/04_login_filled.png) |

---

### Workflow 3: Summary Report (`Home` Tab)
1. After signing in (or clicking **Home** in the bottom navigation bar), the **Summary Report** screen loads data from `GET /gethomereport?spersonId=1`.
2. **Header Controls (`#00aae6` background):**
   - **Date:** Read-only OutlinedBox displaying today's date in `dd-MM-yyyy` format.
   - **Cluster:** OutlinedDropdown containing the clusters returned by the API (`Pollachi and Udumalapet` and `Thuthukudi`). Selecting a cluster updates all three summary sections below for that cluster.
3. **Delivery Status Summary:**
   - Displays a yellow header bar (`Item Name | Total | Delivered | Inprogress`) and `#f0f7f7` rows for each commodity (`Onio Medium`, `Onion Big`, `Agra Potato`, `Local Potato (Thimbam/Kolar)`).
   - Matches `HR_DeliveryStatus_LinearAdapter.java`, displaying each item's `totalcount` alongside the APK's hardcoded `"11"` (`Delivered`) and `"22"` (`Inprogress`) columns.
4. **Shop Status Summary:**
   - Displays four `#f7ef02` yellow summary cards:
     - `Total Number Of Shops`
     - `Number Of Ordered Shops`
     - `Number Of Not Ordered Shops`
     - `Number Of Sops Not Connected` (preserving the exact label from `HomeReport.java` line 297).
5. **Item Orders Status Summary:**
   - Displays `#f7ef02` yellow cards with the total order count per item (`order_item_status`).

![Summary Report Screen](docs/screenshots/05_home_summary_report.png)

---

### Workflow 4: Customer / Shop Registration (`Registration` Tab)
1. Click **Registration** in the bottom navigation bar to open the **Customer Registration** screen (`GET /clusterinfo?spersonId=1`).
2. **Complete the Shop Details:**
   - **Cluster:** Select a cluster (`Pollachi and Udumalapet` or `Thuthukudi`). Selecting a cluster also refreshes the **Weekly Req In Units** survey items below.
   - **Shop Name:** Enter the store name (up to 50 characters).
   - **Shop Category:** Choose from `@array/shopcategory_array` (`Retail`, `SuperMarket`, `HoReCa`, `ChainRetail`, `FruitShop`).
   - **Owner Name:** Enter the shop owner's name (up to 50 characters).
   - **Contact Number1 & Contact Number2:** Enter phone numbers (up to 13 digits).
   - **ModeOfPayment:** Choose from `@array/paymentmode_array` (`Online`, `Cash`).
3. **Set Shop Location on Map & Reverse Geocode:**
   - Click anywhere on the `350px × 350px` map (or click the top-right GPS target button) to set the **Shop Location** marker.
   - The read-only **Latitude** and **Longitude** fields update immediately, and the app queries OpenStreetMap Nominatim (`https://nominatim.openstreetmap.org/reverse?format=json...`) to auto-populate **Address** and **PinCode** (or displays Toast `"Address Not Available"` if offline).
4. **Weekly Req In Units:**
   - Enter estimated weekly quantities (in units) for any of the 8 survey items (`Onio Medium`, `Onion Big`, `Agra Potato`, `Local Potato (Thimbam/Kolar)`, `Tomato Hybrid`, `Tomato Nati`, `Coconut`, `Sambar Onion`).
5. **Capture / Upload Shop Photo:**
   - Click the `200px × 200px` image box under **Click Image To Capture Shop Photo** to select or capture a storefront image.
6. **Validation & Submission (`POST /addcustomer`):**
   - Clicking **SUBMIT** validates fields in the exact APK order:
     1. Missing Cluster $\rightarrow$ `"Please Select Valid Cluster."`
     2. Empty Shop Name $\rightarrow$ `"Please Enter Valid Shop Name."`
     3. Empty Owner Name $\rightarrow$ `"Please Enter Valid Owner Name."`
     4. Empty Contact Number1 $\rightarrow$ `"Please Enter Valid Contact Number1."`
     5. Empty Latitude/Longitude $\rightarrow$ `"Invalid Location Lat/Long Please Enable Location Services."`
     6. Empty Address $\rightarrow$ `"Please Enter Valid Address."`
     7. Empty PinCode $\rightarrow$ `"Please Enter Valid Pincode."`
     8. Photo not uploaded (after first submission reset) $\rightarrow$ `"Please Capture Shop Photo"`
   - When valid, `POST /addcustomer` is called. On `status: 200`, the app displays Toast `"Customer Created Successfully"`, clears the text fields, resets the image preview to `no_image.jpg`, and adds the new shop to the selected cluster so it can immediately be ordered for in **OrderRequest**.

| Registration Top & Map | Weekly Req & Photo Capture |
| :---: | :---: |
| ![Registration Top](docs/screenshots/06_registration_top_map.png) | ![Registration Bottom](docs/screenshots/07_registration_weekly_req_photo.png) |

---

### Workflow 5: Placing a Shop Order (`OrderRequest` Tab)
1. Click **OrderRequest** in the bottom navigation bar (`GET /getitemsorder?spersonId=1`).
2. **Select Cluster & Shop:**
   - **Date:** Automatically displays today's date (`dd-MM-yyyy`).
   - **Cluster:** Select a cluster (`Pollachi and Udumalapet` or `Thuthukudi`). This populates the **Shop Name** dropdown for that cluster.
   - **Shop Name:** Select a registered shop (e.g., `SLV Vegies`, `Moksha Vegies`, `Kovai Pazhamudir Nilayam`, or any newly registered customer).
   - **Contact Boxes:** The two side-by-side read-only **Contact** boxes auto-populate with the selected shop's `contact1` and `contact2`. Clicking either box initiates a `tel:` phone call.
3. **Enter Commodity Quantities, Custom Prices & Remarks:**
   - Each item card displays:
     - Rounded item image (`onion_fresh.png`, `onion_sambar.jpeg`, or `no_image.jpg` fallback) with a `2px` `#f7ef02` border
     - Bold yellow item name and read-only **Unit Type** (`Kgs`, `Bag (50Kg)`, `Box (25Kg)`)
     - **Units #** (editable quantity) and read-only **Unit Price**
     - Read-only **Total** and editable **Cust Price**
     - **Remarks** dropdown (`Not Connected`, `Order Placed`, `High Price`, `Invntory Available`, `Shop Closed`, `May be Tomorrow`, `Not interested`)
   - **Automatic Calculation & Remarks (`OrderItemsLinearAdapter.java`):**
     - Typing a positive number in **Units #** automatically calculates `Total = Units # × Unit Price` and switches **Remarks** to `"Order Placed"`.
     - Setting **Units #** to `0` or clearing it automatically switches **Remarks** back to `"Not Connected"`.
4. **Submit Order (`POST /createorder`):**
   - Clicking **SUBMIT** without selecting a Cluster shows Toast `"Please Select Valid Cluster."`
   - Clicking **SUBMIT** without selecting a Shop shows Toast `"Please Select Valid Shop."`
   - Clicking **SUBMIT** with a valid Cluster and Shop sends `OrderRequestData` to `POST /createorder` and displays Toast `"Order Created Successfully"`.

![Order Request Screen](docs/screenshots/08_order_request.png)

---

### Workflow 6: Viewing Order Reports (`Reports` Tab)
1. Click **Reports** in the bottom navigation bar.
2. Matches `res/layout/fragment_order_reports.xml` (`OrderReports.java`):
   - Top row of 3 dark pill buttons: **TODAY**, **19-09-2026**, and **18-09-2026**.
   - **Store 1 (`560049_1` — `SLV Vegies`):** Shows table columns `Item | QTY | Amount | Delivary Status` with rows `Onion (20 | 1200 | Delivered)`, `Potato (10 | 3400 | Ordered)`, and `Banana Robusta (0 | 0 | Not Ordered)`.
   - **Store 2 (`560049_2` — `Moksha Vegies`):** Shows rows `Onion (NA | NA | OrderNotPlaced)`, `Tomato Hybrid (NA | NA | OrderNotPlaced)`, and `Banana Elaki (NA | NA | OrderNotPlaced)`.

![Reports Screen](docs/screenshots/09_reports.png)
