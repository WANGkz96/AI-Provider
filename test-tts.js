// test-tts.js
const main = async () => {
  try {
    const res = await fetch('http://localhost:8000/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: "Привет! Это тест.",
        language_id: "ru",
        voice_sample: "ru_prompts1.flac"
      })
    });
    
    if (!res.ok) {
        console.error('Error:', res.status, await res.text());
    } else {
        const data = await res.json();
        console.log('Success:', JSON.stringify(data, null, 2));
    }
  } catch (e) {
    console.error(e);
  }
};
main();

