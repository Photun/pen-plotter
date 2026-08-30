#include <Arduino.h>
#include <Servo.h>

const int A_STEP = 2;  // CNC Shield X driver = CoreXY motor A
const int B_STEP = 3;  // CNC Shield Y driver = CoreXY motor B
const int A_DIR = 5;
const int B_DIR = 6;
const int EN_PIN = 8;  // active LOW

const int SERVO_POWER_PIN = 11;  // CNC Shield Z-limit signal -> MOSFET gate
const int SERVO_PIN = 12;        // CNC Shield SpnEn -> servo signal

const int PEN_UP = 80;
const int PEN_DOWN = 130;
int penUpDelay = 200;
int penDownDelay = 600;
int penUpLiftPercent = 100;

const int MIN_STEP_DELAY = 1;
const int DEFAULT_FAST_DELAY = 50;
const int START_STEP_DELAY = 600;
const float BEZIER_SAMPLE_MM = 1.0;
const int BEZIER_MIN_SEGMENTS = 8;
const int BEZIER_MAX_SEGMENTS = 220;
const float DEFAULT_ACCEL_STEPS_PER_SECOND2 = 10000.0;

// GT2 belt, 20T pulley, 1.8 degree motor, 1/32 microstepping:
// 200 * 32 / (20 * 2) = 160 steps/mm
const float STEPS_PER_MM = 160.0;

float X_MAX = 406.0;
float Y_MAX = 370.0;

float currentX = 0.0;
float currentY = 0.0;

// Higher delay = slower motion. Lower delay = faster motion.
int fastDelay = DEFAULT_FAST_DELAY;
float accelStepsPerSecond2 = DEFAULT_ACCEL_STEPS_PER_SECOND2;

bool servoPowered = false;
bool motorsEnabled = false;
bool homeConfirmed = false;
volatile bool abortRequested = false;

String inputLine = "";
Servo penServo;

void processLine(String line);
void processManualCommand(String cmd);
bool processGCode(String line);
String stripGCodeComments(String line);
bool pollRealtimeAbort();
void clearMotionAbort();
bool getWord(const String &line, char letter, float &value);
void confirmManualHome();
void printHelp();
void printGCodeHelp();
void printPosition();
void setMotorsEnabled(bool enabled);
void servoPowerOn();
void servoPowerOff();
void penUp();
void penDown();
int effectivePenUpAngle();
bool setPenDelay(char which, int newDelay, bool report);
bool setPenUpLiftPercent(int newPercent, bool report);
bool drawCircle(float centerX, float centerY, float radius, bool report);
bool moveTo(float targetX, float targetY, bool report);
bool bezierTo(float control1X, float control1Y, float control2X, float control2Y,
              float targetX, float targetY, bool report);
float cubicPoint(float p0, float p1, float p2, float p3, float t);
int bezierSegmentCount(float startX, float startY, float control1X, float control1Y,
                       float control2X, float control2Y, float targetX, float targetY);
void coreXYStepsBetween(float fromX, float fromY, float toX, float toY,
                        long &aSteps, long &bSteps);
long maxCoreXYSteps(long aSteps, long bSteps);
long stepCoreXY(long aSteps, long bSteps);
long stepCoreXYProfile(long aSteps, long bSteps, long &profileStep, long profileSteps);
int motionDelayForStep(long stepIndex, long totalSteps);
bool setStepDelay(int newDelay, bool report);
void setFeedRate(float feedRateMmPerMin, bool report);
bool setAcceleration(float newAccel, bool report);

void setup() {
  pinMode(A_STEP, OUTPUT);
  pinMode(B_STEP, OUTPUT);
  pinMode(A_DIR, OUTPUT);
  pinMode(B_DIR, OUTPUT);
  pinMode(EN_PIN, OUTPUT);

  pinMode(SERVO_POWER_PIN, OUTPUT);
  digitalWrite(SERVO_POWER_PIN, LOW);
  setMotorsEnabled(true);

  Serial.begin(115200);
  delay(500);

  printHelp();
  Serial.println(F("Startup state: servo power OFF; home not confirmed."));
  printPosition();
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();

    if (c == '!' || c == 24) {
      abortRequested = true;
      continue;
    }

    if (c == '\n' || c == '\r') {
      inputLine.trim();

      if (inputLine.length() > 0) {
        processLine(inputLine);
        inputLine = "";
      }
    } else {
      inputLine += c;
    }
  }
}

void processLine(String line) {
  line.trim();

  if (line.length() == 0) {
    return;
  }

  String cleaned = stripGCodeComments(line);
  cleaned.trim();

  if (cleaned.length() == 0) {
    Serial.println(F("ok"));
    return;
  }

  cleaned.toLowerCase();

  if (cleaned == "!" || cleaned == "abort" || cleaned == "stop") {
    abortRequested = true;
    Serial.println(F("Realtime abort requested."));
    Serial.println(F("ok"));
    return;
  }

  clearMotionAbort();

  char first = cleaned.charAt(0);
  if ((first == 'g' || first == 'm') && cleaned.length() > 1 &&
      isDigit(cleaned.charAt(1))) {
    bool ok = processGCode(cleaned);
    Serial.println(ok ? F("ok") : F("error"));
    return;
  }

  processManualCommand(cleaned);
}

void processManualCommand(String cmd) {
  if (cmd == "h") {
    confirmManualHome();
    return;
  }

  if (cmd == "?" || cmd == "help") {
    printHelp();
    return;
  }

  if (cmd == "gcode") {
    printGCodeHelp();
    return;
  }

  if (cmd == "p") {
    printPosition();
    return;
  }

  if (cmd == "u") {
    servoPowerOn();
    penUp();
    Serial.println(F("Pen up."));
    return;
  }

  if (cmd == "d") {
    servoPowerOn();
    penDown();
    Serial.println(F("Pen down."));
    return;
  }

  if (cmd == "penoff" || cmd == "soff") {
    servoPowerOff();
    return;
  }

  if (cmd == "penon" || cmd == "son") {
    servoPowerOn();
    return;
  }

  if (cmd == "moff") {
    setMotorsEnabled(false);
    Serial.println(F("Motors disabled."));
    return;
  }

  if (cmd == "mon") {
    setMotorsEnabled(true);
    Serial.println(F("Motors enabled."));
    return;
  }

  if (cmd == "test") {
    servoPowerOn();
    delay(500);
    penUp();
    delay(800);
    penDown();
    delay(800);
    penUp();
    delay(800);
    servoPowerOff();
    return;
  }

  if (cmd.startsWith("accel ")) {
    setAcceleration(cmd.substring(6).toFloat(), true);
    return;
  }

  char type = cmd.charAt(0);

  if (type == 'a') {
    int firstSpace = cmd.indexOf(' ');

    if (firstSpace == -1) {
      Serial.println(F("Bad servo command. Use: a 100"));
      return;
    }

    int angle = cmd.substring(firstSpace + 1).toInt();

    if (angle < 0 || angle > 180) {
      Serial.println(F("Angle blocked. Use 0 to 180."));
      return;
    }

    servoPowerOn();
    penServo.write(angle);
    delay(500);

    Serial.print(F("Servo angle set to "));
    Serial.println(angle);
    return;
  }

  if (type == 'c') {
    int s1 = cmd.indexOf(' ');
    int s2 = cmd.indexOf(' ', s1 + 1);
    int s3 = cmd.indexOf(' ', s2 + 1);

    if (s1 == -1 || s2 == -1 || s3 == -1) {
      Serial.println(F("Bad circle command. Use: c 203 185 40"));
      return;
    }

    float centerX = cmd.substring(s1 + 1, s2).toFloat();
    float centerY = cmd.substring(s2 + 1, s3).toFloat();
    float radius = cmd.substring(s3 + 1).toFloat();

    drawCircle(centerX, centerY, radius, true);
    return;
  }

  if (type == 'r' || type == 'g' || type == 'l') {
    int firstSpace = cmd.indexOf(' ');
    int secondSpace = cmd.indexOf(' ', firstSpace + 1);

    if (firstSpace == -1 || secondSpace == -1) {
      Serial.println(F("Bad command format. Use: r 10 0 or g 50 20 or l 406 370"));
      return;
    }

    float a = cmd.substring(firstSpace + 1, secondSpace).toFloat();
    float b = cmd.substring(secondSpace + 1).toFloat();

    if (type == 'r') {
      moveTo(currentX + a, currentY + b, true);
      return;
    }

    if (type == 'g') {
      moveTo(a, b, true);
      return;
    }

    if (type == 'l') {
      X_MAX = a;
      Y_MAX = b;
      Serial.print(F("Soft limits updated: X_MAX="));
      Serial.print(X_MAX);
      Serial.print(F(" Y_MAX="));
      Serial.println(Y_MAX);
      printPosition();
      return;
    }
  }

  if (type == 's') {
    int firstSpace = cmd.indexOf(' ');

    if (firstSpace == -1) {
      Serial.println(F("Bad speed command. Use: s 1"));
      return;
    }

    setStepDelay(cmd.substring(firstSpace + 1).toInt(), true);
    return;
  }

  Serial.println(F("Unknown command. Send ? for help."));
}

bool processGCode(String line) {
  float value;

  if (getWord(line, 'f', value)) {
    setFeedRate(value, false);
  }

  if (getWord(line, 'g', value)) {
    int code = lround(value);

    if (code == 0 || code == 1) {
      float targetX = currentX;
      float targetY = currentY;

      if (getWord(line, 'x', value)) {
        targetX = value;
      }
      if (getWord(line, 'y', value)) {
        targetY = value;
      }

      if (code == 0) {
        servoPowerOn();
        penUp();
      }

      return moveTo(targetX, targetY, false);
    }

    if (code == 5) {
      float targetX;
      float targetY;
      float control1X;
      float control1Y;
      float control2X;
      float control2Y;

      if (!getWord(line, 'x', targetX) || !getWord(line, 'y', targetY) ||
          !getWord(line, 'i', control1X) || !getWord(line, 'j', control1Y) ||
          !getWord(line, 'p', control2X) || !getWord(line, 'q', control2Y)) {
        Serial.println(F("G5 needs X Y I J P Q for cubic Bezier."));
        return false;
      }

      return bezierTo(control1X, control1Y, control2X, control2Y,
                      targetX, targetY, false);
    }

    if (code == 21) {
      return true;
    }

    if (code == 28) {
      float confirm = 0;
      if (!getWord(line, 'p', confirm) || lround(confirm) != 1) {
        Serial.println(F("G28 needs manual confirmation. Move to bottom-left, then send G28 P1."));
        return false;
      }

      confirmManualHome();
      return true;
    }

    if (code == 90) {
      return true;
    }

    if (code == 91) {
      Serial.println(F("G91 relative mode is not supported yet. Use absolute G90."));
      return false;
    }

    Serial.print(F("Unsupported G-code: G"));
    Serial.println(code);
    return false;
  }

  if (getWord(line, 'm', value)) {
    int code = lround(value);

    if (code == 3) {
      servoPowerOn();
      penDown();
      return true;
    }

    if (code == 5) {
      servoPowerOn();
      penUp();
      return true;
    }

    if (code == 17) {
      setMotorsEnabled(true);
      return true;
    }

    if (code == 18 || code == 84) {
      setMotorsEnabled(false);
      return true;
    }

    if (code == 30 || code == 2) {
      servoPowerOn();
      penUp();
      servoPowerOff();
      return true;
    }

    if (code == 114) {
      printPosition();
      return true;
    }

    if (code == 204) {
      float accel;
      if (!getWord(line, 's', accel)) {
      Serial.println(F("M204 needs S acceleration, example: M204 S10000"));
        return false;
      }

      return setAcceleration(accel, true);
    }

    if (code == 340) {
      bool changed = false;
      float upValue = 0;
      float downValue = 0;
      float liftValue = 0;

      if (getWord(line, 'u', upValue)) {
        if (!setPenDelay('u', lround(upValue), false)) {
          return false;
        }
        changed = true;
      }

      if (getWord(line, 'd', downValue)) {
        if (!setPenDelay('d', lround(downValue), false)) {
          return false;
        }
        changed = true;
      }

      if (getWord(line, 'l', liftValue)) {
        if (!setPenUpLiftPercent(lround(liftValue), false)) {
          return false;
        }
        changed = true;
      }

      if (!changed) {
        Serial.println(F("M340 needs U, D, and/or L, example: M340 U200 D600 L100"));
        return false;
      }

      return true;
    }

    Serial.print(F("Unsupported M-code: M"));
    Serial.println(code);
    return false;
  }

  return true;
}

String stripGCodeComments(String line) {
  int semicolon = line.indexOf(';');
  if (semicolon != -1) {
    line = line.substring(0, semicolon);
  }

  int openParen = line.indexOf('(');
  while (openParen != -1) {
    int closeParen = line.indexOf(')', openParen + 1);
    if (closeParen == -1) {
      line = line.substring(0, openParen);
    } else {
      line = line.substring(0, openParen) + line.substring(closeParen + 1);
    }
    openParen = line.indexOf('(');
  }

  return line;
}

bool pollRealtimeAbort() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '!' || c == 24) {
      abortRequested = true;
    }
  }

  return abortRequested;
}

void clearMotionAbort() {
  abortRequested = false;
}

bool getWord(const String &line, char letter, float &value) {
  for (unsigned int i = 0; i < line.length(); i++) {
    if (line.charAt(i) == letter) {
      value = line.substring(i + 1).toFloat();
      return true;
    }
  }

  return false;
}

void confirmManualHome() {
  currentX = 0;
  currentY = 0;
  homeConfirmed = true;
  Serial.println(F("Manual home confirmed. Current position = X0 Y0."));
  printPosition();
}

void printHelp() {
  Serial.println();
  Serial.println(F("CoreXY pen plotter manual control ready."));
  Serial.println();
  Serial.println(F("Coordinate system:"));
  Serial.println(F("  X0 Y0     = bottom-left manual home"));
  Serial.println(F("  X203 Y185 = center"));
  Serial.println(F("  X406 Y370 = far corner"));
  Serial.println();
  Serial.println(F("Manual homing:"));
  Serial.println(F("  1. Type moff to release motors, if needed."));
  Serial.println(F("  2. Push gantry/toolhead to bottom-left home."));
  Serial.println(F("  3. Type mon to enable motors."));
  Serial.println(F("  4. Type h to set X0 Y0."));
  Serial.println();
  Serial.println(F("Manual commands:"));
  Serial.println(F("  ?              = show this help"));
  Serial.println(F("  gcode          = show supported G-code"));
  Serial.println(F("  h              = confirm manual home as X0 Y0"));
  Serial.println(F("  !              = realtime abort current motion"));
  Serial.println(F("  p              = print current position"));
  Serial.println(F("  r dx dy         = relative move in mm"));
  Serial.println(F("  g x y           = absolute move in mm"));
  Serial.println(F("  c x y radius    = draw circle"));
  Serial.println(F("  l xmax ymax     = set soft limits"));
  Serial.println(F("  s fastDelay     = set step delay, 1 or higher"));
  Serial.println(F("  accel n         = set accel in steps/sec^2"));
  Serial.println(F("  mon / moff      = enable / disable motors"));
  Serial.println(F("  son / soff      = servo power on / off"));
  Serial.println(F("  u / d           = pen up / pen down"));
  Serial.println(F("  a angle         = servo angle"));
  Serial.println(F("  test            = servo power movement test"));
  Serial.println();
}

void printGCodeHelp() {
  Serial.println();
  Serial.println(F("Supported plotter G-code:"));
  Serial.println(F("  G21             = millimeters"));
  Serial.println(F("  G90             = absolute coordinates"));
  Serial.println(F("  G28 P1          = confirm manual home at X0 Y0"));
  Serial.println(F("  G0 Xnnn Ynnn    = travel move, pen up"));
  Serial.println(F("  G1 Xnnn Ynnn Ff = drawing/feed move"));
  Serial.println(F("  G5 X Y I J P Q  = cubic Bezier, absolute controls"));
  Serial.println(F("  M204 Snnn       = set accel in steps/sec^2"));
  Serial.println(F("  M340 Ummm Dmmm Lpct = set pen delays and up lift percent"));
  Serial.println(F("  M3              = pen down"));
  Serial.println(F("  M5              = pen up"));
  Serial.println(F("  M17             = motors enabled"));
  Serial.println(F("  M18 / M84       = motors disabled"));
  Serial.println(F("  M114            = report position"));
  Serial.println(F("  M2 / M30        = end program, pen up and servo off"));
  Serial.println();
}

void printPosition() {
  Serial.print(F("Position: X="));
  Serial.print(currentX);
  Serial.print(F(" Y="));
  Serial.print(currentY);
  Serial.print(F(" | Limits: X_MAX="));
  Serial.print(X_MAX);
  Serial.print(F(" Y_MAX="));
  Serial.print(Y_MAX);
  Serial.print(F(" | fastDelay="));
  Serial.print(fastDelay);
  Serial.print(F(" | accel="));
  Serial.print(accelStepsPerSecond2);
  Serial.print(F(" | penUpDelay="));
  Serial.print(penUpDelay);
  Serial.print(F(" | penDownDelay="));
  Serial.print(penDownDelay);
  Serial.print(F(" | penUpLift="));
  Serial.print(penUpLiftPercent);
  Serial.print(F("%"));
  Serial.print(F(" | home="));
  Serial.print(homeConfirmed ? F("YES") : F("NO"));
  Serial.print(F(" | motors="));
  Serial.print(motorsEnabled ? F("ON") : F("OFF"));
  Serial.print(F(" | servoPower="));
  Serial.println(servoPowered ? F("ON") : F("OFF"));
}

void setMotorsEnabled(bool enabled) {
  digitalWrite(EN_PIN, enabled ? LOW : HIGH);
  motorsEnabled = enabled;
}

void servoPowerOn() {
  if (servoPowered) {
    return;
  }

  Serial.println(F("Turning servo power ON..."));

  penServo.write(effectivePenUpAngle());
  penServo.attach(SERVO_PIN);
  delay(100);

  digitalWrite(SERVO_POWER_PIN, HIGH);
  servoPowered = true;

  delay(500);
  penServo.write(effectivePenUpAngle());
  delay(penUpDelay);

  Serial.println(F("Servo power ON."));
}

void servoPowerOff() {
  if (!servoPowered) {
    Serial.println(F("Servo power already OFF."));
    return;
  }

  Serial.println(F("Turning servo power OFF..."));

  penServo.write(PEN_UP);
  delay(penUpDelay);

  digitalWrite(SERVO_POWER_PIN, LOW);
  servoPowered = false;

  delay(200);
  penServo.detach();

  Serial.println(F("Servo power OFF."));
}

void penUp() {
  penServo.write(effectivePenUpAngle());
  delay(penUpDelay);
}

void penDown() {
  penServo.write(PEN_DOWN);
  delay(penDownDelay);
}

int effectivePenUpAngle() {
  long span = long(PEN_UP) - long(PEN_DOWN);
  return int(long(PEN_DOWN) + (span * long(penUpLiftPercent)) / 100L);
}

bool setPenDelay(char which, int newDelay, bool report) {
  if (newDelay < 0 || newDelay > 2000) {
    if (report) {
      Serial.println(F("Pen delay blocked. Use 0 to 2000 ms."));
    }
    return false;
  }

  if (which == 'u') {
    penUpDelay = newDelay;
  } else if (which == 'd') {
    penDownDelay = newDelay;
  } else {
    return false;
  }

  if (report) {
    Serial.print(F("Pen delays updated. up="));
    Serial.print(penUpDelay);
    Serial.print(F(" down="));
    Serial.println(penDownDelay);
  }

  return true;
}

bool setPenUpLiftPercent(int newPercent, bool report) {
  if (newPercent < 0 || newPercent > 100) {
    if (report) {
      Serial.println(F("Pen lift blocked. Use 0 to 100 percent."));
    }
    return false;
  }

  penUpLiftPercent = newPercent;

  if (report) {
    Serial.print(F("Pen up lift updated. lift="));
    Serial.print(penUpLiftPercent);
    Serial.println(F("%"));
  }

  return true;
}

bool drawCircle(float centerX, float centerY, float radius, bool report) {
  if (radius <= 0) {
    Serial.println(F("Circle blocked. Radius must be positive."));
    return false;
  }

  if (centerX - radius < 0 || centerX + radius > X_MAX ||
      centerY - radius < 0 || centerY + radius > Y_MAX) {
    Serial.println(F("Circle blocked by soft limits."));
    Serial.print(F("Circle needs X="));
    Serial.print(centerX - radius);
    Serial.print(F(" to "));
    Serial.print(centerX + radius);
    Serial.print(F(" | Y="));
    Serial.print(centerY - radius);
    Serial.print(F(" to "));
    Serial.println(centerY + radius);
    printPosition();
    return false;
  }

  const int segments = 72;
  const float FULL_CIRCLE = 6.28318530718;

  if (report) {
    Serial.print(F("Drawing circle: center X="));
    Serial.print(centerX);
    Serial.print(F(" Y="));
    Serial.print(centerY);
    Serial.print(F(" radius="));
    Serial.println(radius);
  }

  servoPowerOn();
  penUp();
  if (!moveTo(centerX + radius, centerY, report)) {
    return false;
  }
  penDown();

  for (int i = 1; i <= segments; i++) {
    float angle = FULL_CIRCLE * i / segments;
    float x = centerX + radius * cos(angle);
    float y = centerY + radius * sin(angle);

    if (!moveTo(x, y, report)) {
      penUp();
      return false;
    }
  }

  penUp();

  if (report) {
    Serial.println(F("Circle done."));
  }

  return true;
}

bool moveTo(float targetX, float targetY, bool report) {
  if (!homeConfirmed) {
    Serial.println(F("Move blocked. Manually home first, then send h or G28 P1."));
    return false;
  }

  if (!motorsEnabled) {
    Serial.println(F("Move blocked. Motors are disabled. Send mon or M17."));
    return false;
  }

  if (targetX < 0 || targetX > X_MAX || targetY < 0 || targetY > Y_MAX) {
    Serial.println(F("Move blocked by soft limits."));
    Serial.print(F("Requested: X="));
    Serial.print(targetX);
    Serial.print(F(" Y="));
    Serial.println(targetY);
    printPosition();
    return false;
  }

  long aSteps;
  long bSteps;
  coreXYStepsBetween(currentX, currentY, targetX, targetY, aSteps, bSteps);
  long totalSteps = maxCoreXYSteps(aSteps, bSteps);
  float startX = currentX;
  float startY = currentY;

  if (report) {
    Serial.print(F("Moving to X="));
    Serial.print(targetX);
    Serial.print(F(" Y="));
    Serial.println(targetY);
  }

  long completedSteps = stepCoreXY(aSteps, bSteps);

  if (abortRequested || completedSteps < totalSteps) {
    float fraction = totalSteps > 0 ? (float)completedSteps / (float)totalSteps : 1.0;
    currentX = startX + (targetX - startX) * fraction;
    currentY = startY + (targetY - startY) * fraction;
    Serial.println(F("Move aborted."));
    printPosition();
    return false;
  }

  currentX = targetX;
  currentY = targetY;

  if (report) {
    printPosition();
  }

  return true;
}

bool bezierTo(float control1X, float control1Y, float control2X, float control2Y,
              float targetX, float targetY, bool report) {
  if (!homeConfirmed) {
    Serial.println(F("Bezier blocked. Manually home first, then send h or G28 P1."));
    return false;
  }

  if (!motorsEnabled) {
    Serial.println(F("Bezier blocked. Motors are disabled. Send mon or M17."));
    return false;
  }

  if (control1X < 0 || control1X > X_MAX || control1Y < 0 || control1Y > Y_MAX ||
      control2X < 0 || control2X > X_MAX || control2Y < 0 || control2Y > Y_MAX ||
      targetX < 0 || targetX > X_MAX || targetY < 0 || targetY > Y_MAX) {
    Serial.println(F("Bezier blocked by soft limits."));
    printPosition();
    return false;
  }

  const float startX = currentX;
  const float startY = currentY;
  const int segments = bezierSegmentCount(startX, startY, control1X, control1Y,
                                          control2X, control2Y, targetX, targetY);

  long profileSteps = 0;
  float prevX = startX;
  float prevY = startY;

  for (int i = 1; i <= segments; i++) {
    float t = (float)i / (float)segments;
    float x = cubicPoint(startX, control1X, control2X, targetX, t);
    float y = cubicPoint(startY, control1Y, control2Y, targetY, t);
    long aSteps;
    long bSteps;
    coreXYStepsBetween(prevX, prevY, x, y, aSteps, bSteps);
    profileSteps += maxCoreXYSteps(aSteps, bSteps);
    prevX = x;
    prevY = y;
  }

  if (profileSteps == 0) {
    currentX = targetX;
    currentY = targetY;
    return true;
  }

  if (report) {
    Serial.print(F("Bezier to X="));
    Serial.print(targetX);
    Serial.print(F(" Y="));
    Serial.println(targetY);
  }

  long profileStep = 0;
  prevX = startX;
  prevY = startY;

  for (int i = 1; i <= segments; i++) {
    float t = (float)i / (float)segments;
    float x = cubicPoint(startX, control1X, control2X, targetX, t);
    float y = cubicPoint(startY, control1Y, control2Y, targetY, t);
    long aSteps;
    long bSteps;
    coreXYStepsBetween(prevX, prevY, x, y, aSteps, bSteps);
    long segmentSteps = maxCoreXYSteps(aSteps, bSteps);
    long completedSteps = stepCoreXYProfile(aSteps, bSteps, profileStep, profileSteps);
    if (abortRequested || completedSteps < segmentSteps) {
      float fraction = segmentSteps > 0 ? (float)completedSteps / (float)segmentSteps : 1.0;
      currentX = prevX + (x - prevX) * fraction;
      currentY = prevY + (y - prevY) * fraction;
      Serial.println(F("Bezier aborted."));
      printPosition();
      return false;
    }
    prevX = x;
    prevY = y;
    currentX = x;
    currentY = y;
  }

  currentX = targetX;
  currentY = targetY;

  if (report) {
    printPosition();
  }

  return true;
}

float cubicPoint(float p0, float p1, float p2, float p3, float t) {
  float mt = 1.0 - t;
  return mt * mt * mt * p0 +
         3.0 * mt * mt * t * p1 +
         3.0 * mt * t * t * p2 +
         t * t * t * p3;
}

int bezierSegmentCount(float startX, float startY, float control1X, float control1Y,
                       float control2X, float control2Y, float targetX, float targetY) {
  float controlLength =
      hypot(control1X - startX, control1Y - startY) +
      hypot(control2X - control1X, control2Y - control1Y) +
      hypot(targetX - control2X, targetY - control2Y);
  int segments = (int)ceil(controlLength / BEZIER_SAMPLE_MM);
  if (segments < BEZIER_MIN_SEGMENTS) {
    segments = BEZIER_MIN_SEGMENTS;
  }
  if (segments > BEZIER_MAX_SEGMENTS) {
    segments = BEZIER_MAX_SEGMENTS;
  }
  return segments;
}

void coreXYStepsBetween(float fromX, float fromY, float toX, float toY,
                        long &aSteps, long &bSteps) {
  long fromDx = lround(-fromX * STEPS_PER_MM);
  long fromDy = lround(-fromY * STEPS_PER_MM);
  long toDx = lround(-toX * STEPS_PER_MM);
  long toDy = lround(-toY * STEPS_PER_MM);

  long fromA = fromDx + fromDy;
  long fromB = fromDx - fromDy;
  long toA = toDx + toDy;
  long toB = toDx - toDy;

  aSteps = toA - fromA;
  bSteps = toB - fromB;
}

long maxCoreXYSteps(long aSteps, long bSteps) {
  return max(labs(aSteps), labs(bSteps));
}

long stepCoreXY(long aSteps, long bSteps) {
  long profileStep = 0;
  return stepCoreXYProfile(aSteps, bSteps, profileStep, maxCoreXYSteps(aSteps, bSteps));
}

long stepCoreXYProfile(long aSteps, long bSteps, long &profileStep, long profileSteps) {
  bool aDir = aSteps >= 0;
  bool bDir = bSteps >= 0;

  long aTotal = labs(aSteps);
  long bTotal = labs(bSteps);

  digitalWrite(A_DIR, aDir ? HIGH : LOW);
  digitalWrite(B_DIR, bDir ? HIGH : LOW);

  long maxSteps = max(aTotal, bTotal);

  if (maxSteps == 0) {
    return 0;
  }

  long aCounter = 0;
  long bCounter = 0;
  long completedSteps = 0;
  for (long i = 0; i < maxSteps; i++) {
    if (pollRealtimeAbort()) {
      break;
    }

    long delayStep = profileStep;
    if (delayStep >= profileSteps) {
      delayStep = profileSteps - 1;
    }
    int d = motionDelayForStep(delayStep, profileSteps);

    bool stepA = false;
    bool stepB = false;

    aCounter += aTotal;
    bCounter += bTotal;

    if (aCounter >= maxSteps) {
      stepA = true;
      aCounter -= maxSteps;
    }

    if (bCounter >= maxSteps) {
      stepB = true;
      bCounter -= maxSteps;
    }

    if (stepA) {
      digitalWrite(A_STEP, HIGH);
    }
    if (stepB) {
      digitalWrite(B_STEP, HIGH);
    }

    delayMicroseconds(d);

    if (stepA) {
      digitalWrite(A_STEP, LOW);
    }
    if (stepB) {
      digitalWrite(B_STEP, LOW);
    }

    delayMicroseconds(d);

    profileStep++;
    completedSteps++;
  }

  return completedSteps;
}

int motionDelayForStep(long stepIndex, long totalSteps) {
  float startRate = 1000000.0 / (2.0 * START_STEP_DELAY);
  float maxRate = 1000000.0 / (2.0 * fastDelay);
  long stepsFromStart = stepIndex + 1;
  long stepsUntilStop = totalSteps - stepIndex;
  long limitingSteps = min(stepsFromStart, stepsUntilStop);

  float allowedRate = sqrt(startRate * startRate +
                           2.0 * accelStepsPerSecond2 * limitingSteps);

  if (allowedRate > maxRate) {
    allowedRate = maxRate;
  }

  int delayMicros = lround(1000000.0 / (2.0 * allowedRate));

  if (delayMicros < fastDelay) {
    delayMicros = fastDelay;
  }
  if (delayMicros > START_STEP_DELAY) {
    delayMicros = START_STEP_DELAY;
  }

  return delayMicros;
}

bool setStepDelay(int newDelay, bool report) {
  if (newDelay < MIN_STEP_DELAY) {
    if (report) {
      Serial.print(F("Too fast. Use "));
      Serial.print(MIN_STEP_DELAY);
      Serial.println(F(" or higher."));
    }
    return false;
  }

  fastDelay = newDelay;

  if (report) {
    Serial.print(F("Top speed updated. fastDelay="));
    Serial.print(fastDelay);
    Serial.print(F(" accel="));
    Serial.println(accelStepsPerSecond2);
  }

  return true;
}

void setFeedRate(float feedRateMmPerMin, bool report) {
  if (feedRateMmPerMin <= 0) {
    return;
  }

  long delayFromFeed = lround(60000000.0 / (feedRateMmPerMin * STEPS_PER_MM * 2.0));

  if (delayFromFeed < MIN_STEP_DELAY) {
    delayFromFeed = MIN_STEP_DELAY;
  }

  setStepDelay((int)delayFromFeed, report);
}

bool setAcceleration(float newAccel, bool report) {
  if (newAccel < 8000.0 || newAccel > 100000.0) {
    if (report) {
      Serial.println(F("Acceleration blocked. Use 8000 to 100000 steps/sec^2."));
    }
    return false;
  }

  accelStepsPerSecond2 = newAccel;

  if (report) {
    Serial.print(F("Acceleration updated. accel="));
    Serial.print(accelStepsPerSecond2);
    Serial.println(F(" steps/sec^2"));
  }

  return true;
}
