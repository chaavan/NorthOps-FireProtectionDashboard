# Job Pulling Dashboard

A production-ready operations dashboard for fire-protection materials shop, built with Next.js, TypeScript, React, and TailwindCSS.

## 🎯 Overview

This application provides a streamlined interface for shop pullers and receivers to:
- Browse jobs from a Google Sheet
- View all line items for each job
- Mark items as pulled (fully or partially)
- Update quantities in real-time
- Save changes back to Google Sheets in efficient batch updates

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Google Sheets Access

The app uses an API key for simplified authentication:

1. **Share the Google Sheet**:
   - Open: https://docs.google.com/spreadsheets/d/1U-az1-yK4p-GZAbdoK9O9ujM4belavYeBRNogxxEwUQ
   - Click "Share" → Set to "Anyone with the link - Editor"

2. **The API key is pre-configured** - see `ENV_SETUP.md` for details

### 3. Set Environment Variables

Create a `.env.local` file in the root directory:

```bash
GOOGLE_API_KEY=AIzaSyB67btcaTYGDr44Xz3Y2Upd1y7cXY1jpwA
```

⚠️ **Security Note**: Keep this file secure and never commit to git!

### 4. Run the Application

Development mode:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

Production build:
```bash
npm run build
npm start
```

## 📊 Data Source

The application connects to a Google Sheet with the following details:
- **Spreadsheet ID**: `1U-az1-yK4p-GZAbdoK9O9ujM4belavYeBRNogxxEwUQ`
- **Tab Name**: `Job Tracker`
- **Expected Columns** (A-Q):
  - Job Number
  - Job Name
  - Contract #
  - List #
  - Area
  - Location / Ship To
  - Stocklist Date / Delivery Date / Ship Date
  - Unit of Measurement
  - Pulled (quantity)
  - Quantity Needed
  - Pulled By
  - Pulled Date
  - Description
  - Ordered?
  - Recieved from Order?
  - Delivered?
  - Part Number

## 🎨 Features

### Job Selection
- **Search**: Type-ahead search by job number or name
- **Dropdown**: Quick access to all jobs
- **Summary**: View total lines and pulled count for each job

### Line Items Management
- **Editable Quantities**: Manually enter pulled quantities
- **Quick Actions**:
  - "All" button: Mark full quantity as pulled
  - "0" button: Reset to unpulled
  - Checkbox: Toggle between pulled/unpulled
- **Mark All Pulled**: Bulk action for all visible items
- **Filter**: Show only unpulled items

### Visual Feedback
- **Progress Bar**: Real-time completion percentage
- **Highlighting**: Rows with remaining quantities are highlighted
- **Unsaved Changes**: Warning indicator when changes are pending
- **Loading States**: Clear feedback during API operations

### Batch Updates
- All changes are held locally until "Save Changes" is clicked
- Single API call updates all modified rows
- Automatic refresh after save

## 🏗️ Architecture

### Project Structure

```
/app
  /api
    /jobs
      /list          - GET endpoint for job list
      /get           - GET endpoint for job details
      /update        - POST endpoint for batch updates
  page.tsx           - Main dashboard page
  layout.tsx         - Root layout
  globals.css        - Global styles

/components
  JobSelector.tsx    - Job search and selection UI
  JobSummary.tsx     - Summary statistics panel
  JobItemsTable.tsx  - Interactive line items table

/lib
  googleSheets.ts    - Google Sheets API wrapper
  types.ts           - TypeScript type definitions

/public              - Static assets
```

### API Endpoints

#### GET `/api/jobs/list`
Returns all unique jobs with summary information.

**Response:**
```json
{
  "jobs": [
    {
      "jobNumber": "25-1379",
      "jobName": "ZOETIS B300 PHASE 2 SE",
      "lineCount": 45,
      "pulledCount": 23
    }
  ]
}
```

#### GET `/api/jobs/get?jobNumber=XXX`
Returns all line items for a specific job.

**Response:**
```json
{
  "jobNumber": "25-1379",
  "jobName": "ZOETIS B300 PHASE 2 SE",
  "lineItems": [
    {
      "rowIndex": 123,
      "jobNumber": "25-1379",
      "partNumber": "ABC-123",
      "description": "Fire suppression valve",
      "quantityNeeded": 10,
      "quantityPulled": 5,
      ...
    }
  ]
}
```

#### POST `/api/jobs/update`
Updates multiple line items in batch.

**Request:**
```json
{
  "jobNumber": "25-1379",
  "updates": [
    {
      "rowIndex": 123,
      "quantityPulled": 10,
      "pulledBy": "John Doe",
      "pulledDate": "2025-12-01"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "updatedCount": 1,
  "lineItems": [...]
}
```

## 🛠️ Technology Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **UI Library**: React 18
- **Styling**: TailwindCSS
- **API Integration**: Google Sheets API v4
- **Authentication**: Google Service Account (JWT)

## 🚢 Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Connect your repository to Vercel
3. Add environment variable in Vercel dashboard:
   - Key: `GOOGLE_SERVICE_ACCOUNT_JSON`
   - Value: Your service account JSON (single line)
4. Deploy

### Multi-software / multi-branch deployments

The same codebase can be deployed once per branch or software product. Each deployment gets its **own database and auth** (`DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`).

**Portal host** (one deployment — the entry point users visit first):

1. Set `NEXT_PUBLIC_ENABLE_SOFTWARE_PORTAL=true`
2. Set `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` to a public Mapbox token (`pk...`)
3. Unauthenticated users land on `/` and select a location on the cinematic map portal

**Branch / product deployments** (one per software instance):

1. Set `NEXT_PUBLIC_ENABLE_SOFTWARE_PORTAL=false`
2. Set branding: `NEXT_PUBLIC_SOFTWARE_ID`, `NEXT_PUBLIC_SOFTWARE_NAME`, `NEXT_PUBLIC_SOFTWARE_TAGLINE`, `NEXT_PUBLIC_SOFTWARE_LOGO_URL`
3. Optionally set `NEXT_PUBLIC_PORTAL_URL` so the login page links back to the portal
4. Run migrations and create admin users on that deployment's database

**Adding a new software later:**

1. Deploy this repo as a new Vercel project with unique env vars and database
2. Update `lib/locationCatalog.ts` on the portal host:
   - Change the location `status` from `coming_soon` to `active`
   - Set `loginUrl` to the deployment's login URL (e.g. `https://branch-b.example.com/login`)

For production Mapbox usage, restrict the public token to the portal domains in the Mapbox dashboard.

See `ENV_EXAMPLE.txt` for all software portal environment variables.

### Other Platforms

This is a standard Next.js application and can be deployed to any platform that supports Node.js:
- Netlify
- Railway
- AWS (Amplify, ECS, etc.)
- Google Cloud Run
- Self-hosted

## 🔒 Security Considerations

- Service account credentials are stored as environment variables (never commit to git)
- All Google Sheets API calls are made server-side only
- The service account should have minimal permissions (Editor access to the specific sheet only)
- Consider implementing authentication if deploying to public internet

## 🐛 Troubleshooting

### "Failed to read from Google Sheets"
- Verify the Google Sheet is shared with the service account email
- Check that Google Sheets API is enabled in your Google Cloud project
- Ensure the `GOOGLE_SERVICE_ACCOUNT_JSON` environment variable is set correctly

### "Invalid Credentials"
- The JSON in `.env.local` must be on a single line (no newlines)
- Verify the JSON is valid (use a JSON validator)
- Make sure you're using the correct environment file for your deployment environment

### "No line items found"
- Verify the sheet name is exactly "Job Tracker"
- Check that the data starts at row 2 (row 1 should be headers)
- Ensure job numbers in the sheet match what you're searching for

## 📝 Development

### Adding New Features

The codebase is organized for easy extension:
- Add new API routes in `/app/api/`
- Create new components in `/components/`
- Extend types in `/lib/types.ts`
- Add Google Sheets helpers in `/lib/googleSheets.ts`

### Code Style

- TypeScript strict mode enabled
- ESLint configured for Next.js
- Use functional components with hooks
- Follow Next.js App Router conventions

## 📄 License

This project is proprietary software for internal use.

## 🤝 Support

For questions or issues, please contact your development team.

# totalfireprotection
