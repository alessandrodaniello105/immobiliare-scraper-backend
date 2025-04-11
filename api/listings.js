import { sql } from '@vercel/postgres';

// Export a default function that handles the request
export default async function handler(request, response) {
  // Handle GET request to fetch all listings
  if (request.method === 'GET') {
    try {
      const { rows } = await sql`SELECT url, price FROM listings ORDER BY scraped_at DESC;`;
      return response.status(200).json({ listings: rows });
    } catch (error) {
      console.error('Database Error (GET /api/listings):', error);
      return response.status(500).json({ message: 'Error fetching listings from database.', error: error.message });
    }
  }

  // Handle DELETE request to remove all listings
  if (request.method === 'DELETE') {
    try {
      // Use DELETE query - Vercel Postgres SDK doesn't have a direct count return like NeDB
      await sql`DELETE FROM listings;`;
      // Compaction is handled by managed Postgres
      console.log('Deleted all listings from DB.');
      return response.status(200).json({ message: 'Successfully deleted all listings.' });
    } catch (error) {
      console.error('Database Error (DELETE /api/listings):', error);
      return response.status(500).json({ message: 'Error clearing database.', error: error.message });
    }
  }

  // Handle other methods
  response.setHeader('Allow', ['GET', 'DELETE']);
  return response.status(405).json({ message: `Method ${request.method} Not Allowed` });
} 