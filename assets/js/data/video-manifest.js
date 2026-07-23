(function(g){
// A mission type's array is played back-to-back as one continuous mission
// video (see the debrief player in panels.js) — for security that's eight
// ~15s aerial-downlink segments forming a ~2-minute patrol. Single-entry
// types simply play their one clip.
g.VIDEO_MANIFEST = {
  security:     ['security-01.mp4','security-02.mp4','security-03.mp4','security-04.mp4','security-05.mp4','security-06.mp4','security-07.mp4','security-08.mp4'],
  infra:        ['infra-01.mp4'],
  emergency:    ['emergency-01.mp4'],
  delivery:     ['delivery-01.mp4'],
  construction: ['construction-01.mp4'],
  highway:      ['highway-01.mp4'],
  parks:        ['parks-01.mp4']
};
})(typeof window!=='undefined'?window:globalThis);
