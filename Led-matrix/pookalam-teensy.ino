#include <ObjectFLED.h>
#include <FastLED.h>
#include <math.h>

// ============================================================
// HARDWARE
// ============================================================
#define GRID_ROWS 18
#define GRID_COLS 20
#define SERIAL_LINK Serial1
#define BRIGHTNESS 35
#define LED_COLOR_ORDER CORDER_GRB

uint8_t rowPins[GRID_ROWS] = {
  3, 5, 7, 9, 11, 24, 26, 28, 30, 32,
  37, 39, 41, 14, 16, 18, 20, 22
};

CRGB canvas[GRID_ROWS][GRID_COLS];
ObjectFLED leds(GRID_ROWS * GRID_COLS, canvas, LED_COLOR_ORDER, GRID_ROWS, rowPins, 0);

// ============================================================
// ORIENTATION
// ============================================================
#define FLIP_H false   // mirror left/right
#define FLIP_V false   // mirror top/bottom

// ============================================================
// POOKALAM STATE
// ============================================================
int p_petals = 8;
int p_rings = 6;
float p_wobble = 0.18;
float p_spin_speed = 0.6;
bool p_inner_petals = true;
bool p_circle_mask = true;

// Polar grid precalculation
float r_grid[GRID_ROWS][GRID_COLS];
float theta_grid[GRID_ROWS][GRID_COLS];

// Palette (Classic Onam)
#define NUM_COLORS 6
CRGB palette[NUM_COLORS] = {
  CRGB(255, 195, 0),   // #FFC300
  CRGB(255, 122, 0),   // #FF7A00
  CRGB(193, 18, 31),   // #C1121F
  CRGB(255, 255, 255), // #FFFFFF
  CRGB(46, 139, 39),   // #2E8B27
  CRGB(106, 44, 154)   // #6A2C9A
};

// ============================================================
// INIT
// ============================================================
void precalcGrid() {
  float cx = (GRID_COLS - 1) / 2.0;
  float cy = (GRID_ROWS - 1) / 2.0;
  float half = min(cx, cy);
  if (half <= 0) half = 1.0;

  for (int y = 0; y < GRID_ROWS; y++) {
    for (int x = 0; x < GRID_COLS; x++) {
      float dx = x - cx;
      float dy = y - cy;
      r_grid[y][x] = hypotf(dx, dy) / half;
      theta_grid[y][x] = atan2f(dy, dx);
    }
  }
}

// ============================================================
// RENDER LOOP
// ============================================================
void renderPookalam() {
  float t = millis() / 1000.0;
  const float INNER_AMPLITUDE = 0.25;
  const float BAND_DRIFT = 0.4;
  
  for (int y = 0; y < GRID_ROWS; y++) {
    for (int x = 0; x < GRID_COLS; x++) {
      int px = FLIP_H ? (GRID_COLS - 1 - x) : x;
      int py = FLIP_V ? (GRID_ROWS - 1 - y) : y;

      float r = r_grid[py][px];
      float theta = theta_grid[py][px];
      
      // Petal lobes: push the radius in and out as a function of angle.
      float rr = r * (1.0 + p_wobble * cosf(p_petals * theta + t * p_spin_speed));
      
      if (p_inner_petals) {
        // A second, higher-frequency term weighted by (1 - r)
        float centre_weight = 1.0 - r;
        if (centre_weight < 0) centre_weight = 0;
        rr += INNER_AMPLITUDE * centre_weight * cosf(2.0 * p_petals * theta - t * p_spin_speed * 1.5);
      }
      
      if (p_circle_mask && r > 1.0) {
        canvas[y][x] = CRGB::Black;
        continue;
      }
      
      // Quantise radius into colour bands, drifting outward over time.
      int band = (int)floorf(rr * p_rings + t * BAND_DRIFT);
      if (band < 0) {
        band = (band % NUM_COLORS) + NUM_COLORS;
      }
      band = band % NUM_COLORS;
      
      canvas[y][x] = palette[band];
    }
  }
  leds.show();
}

// ============================================================
// SERIAL COMMS
// ============================================================
String command = "";

void processCommand(String cmd) {
  cmd.trim();
  if (cmd.startsWith("K,")) {
    // K,petals,rings,wobble,spin,inner,mask
    int c1 = cmd.indexOf(',');
    int c2 = cmd.indexOf(',', c1 + 1);
    int c3 = cmd.indexOf(',', c2 + 1);
    int c4 = cmd.indexOf(',', c3 + 1);
    int c5 = cmd.indexOf(',', c4 + 1);
    int c6 = cmd.indexOf(',', c5 + 1);
    
    if (c1 < 0 || c2 < 0 || c3 < 0 || c4 < 0 || c5 < 0 || c6 < 0) return;
    
    p_petals = cmd.substring(c1 + 1, c2).toInt();
    p_rings = cmd.substring(c2 + 1, c3).toInt();
    p_wobble = cmd.substring(c3 + 1, c4).toFloat();
    p_spin_speed = cmd.substring(c4 + 1, c5).toFloat();
    p_inner_petals = cmd.substring(c5 + 1, c6).toInt() > 0;
    p_circle_mask = cmd.substring(c6 + 1).toInt() > 0;
  }
}

void readSerial() {
  while (SERIAL_LINK.available()) {
    char c = SERIAL_LINK.read();
    if (c == '<') command = "";
    else if (c == '>') processCommand(command);
    else command += c;
  }
}

// ============================================================
// MAIN
// ============================================================
void setup() {
  Serial.begin(115200);
  SERIAL_LINK.begin(1500000);

  leds.begin();
  leds.setBrightness(BRIGHTNESS);
  precalcGrid();

  Serial.println("POOKALAM NATIVE - TEENSY READY");
}

void loop() {
  readSerial();
  renderPookalam();
}
