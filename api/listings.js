import { sql } from '@vercel/postgres';

export default async function handler(request, response) {
    if (request.method === 'GET') {
        try {
            const { rows } = await sql`SELECT url, price FROM listings ORDER BY scraped_at DESC;`;
            return response.status(200).json({ listings: rows });
        } catch (error) {
            console.error('Database Error (GET /api/listings):', error);
            return response.status(500).json({ message: 'Error fetching listings from database.', error: error.message });
        }
    }

    if (request.method === 'DELETE') {
        try {
            await sql`DELETE FROM listings;`;
            console.log('Deleted all listings from DB.');
            return response.status(200).json({ message: 'Successfully deleted all listings.' });
        } catch (error) {
            console.error('Database Error (DELETE /api/listings):', error);
            return response.status(500).json({ message: 'Error clearing database.', error: error.message });
        }
    }

    response.setHeader('Allow', ['GET', 'DELETE']);
    return response.status(405).json({ message: `Method ${request.method} Not Allowed` });
}