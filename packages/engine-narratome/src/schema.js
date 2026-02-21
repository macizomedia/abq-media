export const narratomeSchema = {
  narratome_version: 'string',
  title: 'string',
  language: ['es', 'en'],
  format: ['reel', 'briefing', 'essay'],
  duration_target_seconds: 'number',
  emotional_arc: 'string',
  acts: [
    {
      act: 'number',
      name: 'string',
      duration_seconds: 'number',
      beats: [
        {
          beat_id: 'string',
          duration_seconds: 'number',
          narration: 'string',
          visual_type: ['b-roll', 'text-overlay', 'data-viz', 'map'],
          visual_prompt: ['string', null],
          visual_source: ['pexels', 'generated', null],
          audio_type: ['narration', 'silence'],
          voice_id: ['HOST_A', 'HOST_B'],
          transition: ['cut', 'fade', 'zoom-in'],
          text_overlay: [{
            text: 'string',
            style: 'string',
            color: 'string'
          }, null]
        }
      ]
    }
  ]
};

export default narratomeSchema;
