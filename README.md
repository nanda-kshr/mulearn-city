# muLearn City

A GitHub-City style visualization for muLearn users.

Each user becomes a building:

- Building height = total karma
- Building glow = recent activity (last N days)
- Building color = hashed from user domain data (interest + organization)

## Data sources

- User directory API:
	- `https://dev.mulearn.org/api/v1/dashboard/user/search/?search=&role=&pageIndex=1&perPage=100`
- Activity log API per user:
	- `https://mulearn.org/api/v1/dashboard/profile/user-log/{muid}/`

The homepage fetches users first, then fetches logs for the top users shown in the city.
In chunk mode, each API page maps to one world chunk block.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Optional configuration

Create `.env.local` and override if required:

```bash
CITY_USERS_API=https://dev.mulearn.org/api/v1/dashboard/user/search/
CITY_LOG_API_BASE=https://mulearn.org/api/v1/dashboard/profile/user-log
CITY_PER_PAGE=100
CITY_USER_LIMIT=100
CITY_RECENT_DAYS=30
CITY_LOAD_DISTANCE=1
CITY_CHUNK_SIZE=44
```

## Notes

- Initial data fetching is server-side (`app/page.tsx`), and incremental chunk loading uses an internal route handler (`app/api/city/chunk/route.ts`).
- Higher `CITY_LOAD_DISTANCE` and `CITY_USER_LIMIT` values load more users/logs and increase network cost.
- If no users load, verify API reachability and environment values.

# mulearn-city
