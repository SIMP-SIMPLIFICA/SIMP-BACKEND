console.log('Testing connection...')
fetch('http://localhost:3000')
    .then(res => console.log('Status:', res.status))
    .catch(err => console.error('Error:', err))
