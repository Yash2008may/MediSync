# MediSync

MediSync is a full-stack healthcare web application (Node.js, Express, PostgreSQL, and React + Vite) for medication reminders, nearby pharmacy discovery, and prescription-backed medicine ordering.

## Key Features
- Global Pharmacy Search and Autocomplete: Powered by Geoapify with fallback mapping support to find nearby pharmacies and addresses.
- Universal Partner Auto-Provisioning: Automatically provisions nearby external pharmacy listings with a starter medicine price list so patients can order with a prescription.
- Prescription and Order Lifecycle: Upload prescriptions (JPG, PNG, PDF), quote medicines from pharmacy inventory, track order statuses, and manage medication reminders.

## Project Structure
- server/ - Express REST API, PostgreSQL schema and migrations, order/prescription/store services, and scheduler jobs.
- client/ - React and Vite frontend with interactive map, pharmacy selection, prescription ordering, and role views.

## Local Setup
1. Configure environment variables by copying server/.env.example to server/.env and setting your PostgreSQL connection string, session/auth secrets, and GEOAPIFY_API_KEY.
2. Install dependencies in server/ and client/ using npm install.
3. Start the backend server with npm run dev inside server/.
4. Build the frontend bundle with npm run build inside client/.
