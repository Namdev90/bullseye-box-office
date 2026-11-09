package in.sharepass.foundation;
final class BackRequestGate { private boolean active; boolean acquire() { if(active)return false;active=true;return true; } void release(){active=false;} }
