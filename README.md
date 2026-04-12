<div align="center">
  <h1>DeckScan</h1>
  <p><strong>MACATHON 2026: Code for Community</strong></p>
  
  <a href="https://professorrazan.github.io/deckscan"><strong>Live App</strong></a> • 
  <a href="https://professorrazan.github.io/deckscan/admin.html"><strong>Admin Panel</strong></a>
</div>

---

### 📍 Overview
[cite_start]**DeckScan** is a real-time parking application designed for Monash University's Sports Precinct[cite: 5]. [cite_start]It provides students with a live heatmap of the **SE4 (multi-level deck)** and **SE5 (surface lot)**, allowing them to identify available spots before they arrive on campus[cite: 5].

### ⚠️ The Problem
[cite_start]Parking at Monash is a daily frustration for hundreds of students[cite: 7]. [cite_start]DeckScan solves this by replacing the "guesswork" of finding a spot with a data-driven tool that utilizes real-time user check-ins[cite: 6, 8].

### 🛠️ Tech Stack
* [cite_start]**Frontend:** HTML, Vanilla JavaScript [cite: 49]
* [cite_start]**Mapping:** Leaflet.js, OpenStreetMap tiles [cite: 15, 49]
* [cite_start]**Database:** Firebase Realtime Database (Live sync < 1s) [cite: 15, 49]
* [cite_start]**Logic:** Inverse Distance Weighting (IDW) algorithm for heatmap rendering [cite: 59]

---

### 🔍 Feature Breakdown: Real vs. Simulated
| Feature | Status | Details |
| :--- | :--- | :--- |
| **Map Rendering** | 🟢 **REAL** | [cite_start]Uses actual OpenStreetMap tiles[cite: 15]. |
| **GPS Location** | 🟢 **REAL** | [cite_start]Browser-based GPS tracks your actual location[cite: 15]. |
| **Live Sync** | 🟢 **REAL** | [cite_start]Firebase pushes updates across devices instantly[cite: 15]. |
| **Check-in/Out** | 🟢 **REAL** | [cite_start]Updates the database and heatmap globally in real-time[cite: 15]. |
| **Occupancy** | 🟡 **SIMULATED** | [cite_start]Seeded with realistic starting values[cite: 15]. |
| **Traffic Drift** | 🟡 **SIMULATED** | [cite_start]Background fluctuations (±1 every 9s) mimic activity[cite: 15]. |
| **Trends/History** | 🟡 **SIMULATED** | [cite_start]Algorithmically generated for demo purposes[cite: 15]. |
| **Parking Zones** | 🟡 **SIMULATED** | [cite_start]Zones appear relative to user GPS, not fixed at Monash[cite: 15, 16]. |

---

### 📝 Prototype Notes
> [cite_start]**Demo note:** In this prototype, parking zones are rendered relative to each user's current GPS location to simulate the experience of arriving at a car park[cite: 16, 52]. [cite_start]In production, zones would be fixed to verified real-world coordinates (Monash SE4/SE5) confirmed on-site[cite: 52]. [cite_start]Live occupancy data is shared in real time across all users via Firebase Realtime Database[cite: 52].

### 🔗 Quick Links
* [cite_start]**Live App:** [professorrazan.github.io/deckscan](https://professorrazan.github.io/deckscan) [cite: 12]
* [cite_start]**Admin Panel:** [professorrazan.github.io/deckscan/admin.html](https://professorrazan.github.io/deckscan/admin.html) [cite: 12]
* [cite_start]**Database:** [Firebase Console (Project deckscan-bda7b)](https://console.firebase.google.com/) [cite: 20]

---
<div align="center">
  [cite_start]<em>Developed for MACATHON 2026</em> [cite: 3, 60]
</div>
