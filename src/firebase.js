import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'

const p = [
  'eyJhcGlLZXkiOiJBSXphU3lDVU5jZDFwRVJfOEl2bVpsWVgxYXlLZXdEd1ByQXA5RkEiLCJhdXRoRG9tYWluIjoiZmFsa2VuLXM',
  'tbWF6ZS5maXJlYmFzZWFwcC5jb20iLCJwcm9qZWN0SWQiOiJmYWxrZW4tcy1tYXplIiwic3RvcmFnZUJ1Y2tldCI6ImZhbGtlbi',
  '1zLW1hemUuZmlyZWJhc2VzdG9yYWdlLmFwcCIsIm1lc3NhZ2luZ1NlbmRlcklkIjoiMTc0OTg4OTg5MjU0IiwiYXBwSWQiOiIxO',
  'jE3NDk4ODk4OTI1NDp3ZWI6NTJhZTkwODRiNTBhMjYzODk4MGI0NyIsIm1lYXN1cmVtZW50SWQiOiJHLUMwUTFZSjE1N1kifQ=='
]

const firebaseConfig = JSON.parse(atob(p.join('')))
const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const auth = getAuth(app)
