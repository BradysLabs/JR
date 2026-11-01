
import flash.display.Bitmap;
import flash.display.BitmapData;
import flash.display.DisplayObjectContainer;
import flash.display.GradientType;
import flash.display.Graphics;
import flash.display.Shape;
import flash.filters.GlowFilter;
import flash.geom.ColorTransform;
import flash.geom.Matrix;
import flash.geom.Point;
import flash.text.Font;
import flash.display.Loader;
import flash.display.LoaderInfo;
import flash.net.FileFilter;
import flash.net.FileReference;
import flash.utils.ByteArray;
import flash.utils.getTimer;
import item.Item;
import den.DenItem;
import den.DenStateItem;
import den.DenXtCommManager;
import room.RoomManagerWorld;
import gui.GuiManager;
import collection.DenItemCollection;
import avatar.MannequinData;
import Enums.DenItemDef;
import avatar.AvatarManager;

// ------------------------------------------------------------------ JR UI
// JR's windows and buttons inside the game, drawn to match Animal Jam's own:
// wooden frames, parchment, blue AJ buttons. JR sends what a window shows as
// JSON (src/game/surfaces); these classes draw it and send back clicks.

class JRStyle
{
   public static const WOOD_DARK:uint = 0x4A2810;
   public static const WOOD:uint = 0x8A5228;
   public static const WOOD_LIGHT:uint = 0xB97E43;
   public static const PARCH:uint = 0xF7EBCD;
   public static const PARCH_LINE:uint = 0xE0C996;
   public static const ROW:uint = 0xFFF8E6;
   public static const ROW_SEL:uint = 0xD8F1FB;
   public static const ROW_EDGE:uint = 0xD9BF8C;
   public static const TEXT:uint = 0x4B2A12;
   public static const DIM:uint = 0x8C6A48;
   public static const OK:uint = 0x2E7D32;
   public static const WARN:uint = 0xB55D00;
   public static const BAD:uint = 0xB3261E;

   // The game's own font, when JR names one that has the letters needed.
   public static var fontName:String = null;
   private static var _fonts:Object = null;

   public static function tone(param1:String) : uint
   {
      if(param1 == "dim")
      {
         return DIM;
      }
      if(param1 == "ok")
      {
         return OK;
      }
      if(param1 == "warn")
      {
         return WARN;
      }
      if(param1 == "bad")
      {
         return BAD;
      }
      return TEXT;
   }

   public static function fonts() : Array
   {
      var _loc1_:Array = [];
      var _loc2_:Font = null;
      for each(_loc2_ in Font.enumerateFonts(false))
      {
         _loc1_.push(_loc2_.fontName + "/" + _loc2_.fontStyle);
      }
      return _loc1_;
   }

   private static function gameFont(param1:String, param2:Boolean) : Font
   {
      var _loc3_:Font = null;
      if(fontName == null)
      {
         return null;
      }
      if(_fonts == null)
      {
         _fonts = {};
         for each(_loc3_ in Font.enumerateFonts(false))
         {
            _fonts[_loc3_.fontName + "/" + _loc3_.fontStyle] = _loc3_;
         }
      }
      _loc3_ = (param2 ? _fonts[fontName + "/bold"] : null) || _fonts[fontName + "/regular"] || _fonts[fontName + "/bold"];
      if(_loc3_ != null && _loc3_.hasGlyphs(param1))
      {
         return _loc3_;
      }
      return null;
   }

   public static function field(param1:String, param2:int, param3:uint, param4:Boolean = false, param5:int = 0, param6:String = "left") : TextField
   {
      var _loc7_:TextField = new TextField();
      var _loc8_:String = param1 == null ? "" : param1;
      var _loc9_:Font = gameFont(_loc8_,param4);
      _loc7_.defaultTextFormat = new TextFormat(_loc9_ != null ? _loc9_.fontName : "Verdana",param2,param3,_loc9_ != null ? _loc9_.fontStyle == "bold" : param4,null,null,null,null,param6);
      _loc7_.embedFonts = _loc9_ != null;
      _loc7_.antiAliasType = "advanced";
      _loc7_.selectable = false;
      _loc7_.mouseEnabled = false;
      if(param5 > 0)
      {
         _loc7_.multiline = true;
         _loc7_.wordWrap = true;
         _loc7_.width = param5;
      }
      _loc7_.autoSize = param6 == "right" ? TextFieldAutoSize.RIGHT : (param6 == "center" ? TextFieldAutoSize.CENTER : TextFieldAutoSize.LEFT);
      _loc7_.text = _loc8_;
      return _loc7_;
   }

   // White text with a dark outline, like the game's button labels.
   public static function outline(param1:TextField, param2:uint) : TextField
   {
      param1.filters = [new GlowFilter(param2,1,3,3,8,2)];
      return param1;
   }

   public static function box(param1:Sprite, param2:Number, param3:Number, param4:uint, param5:Number = 1, param6:int = 8, param7:int = -1) : void
   {
      param1.graphics.clear();
      if(param7 >= 0)
      {
         param1.graphics.lineStyle(1,param7,1);
      }
      param1.graphics.beginFill(param4,param5);
      param1.graphics.drawRoundRect(0,0,param2,param3,param6,param6);
      param1.graphics.endFill();
   }

   // The game's button colors: [top, bottom, edge].
   public static function colors(param1:String) : Array
   {
      if(param1 == "primary" || param1 == "on")
      {
         return [0x9EE36B,0x45A82A,0x245E12];
      }
      if(param1 == "danger")
      {
         return [0xF6A08F,0xD24A3A,0x7A1E16];
      }
      if(param1 == "plain")
      {
         return [0xFBF1D8,0xE4CF9E,0x8A6434];
      }
      return [0x93DEF8,0x2B98D6,0x16598A];
   }

   // A rounded AJ button face: dark edge, gradient, glossy top.
   public static function face(param1:Graphics, param2:Number, param3:Number, param4:Array, param5:Boolean = false) : void
   {
      var _loc6_:Matrix = new Matrix();
      var _loc7_:Number = Math.min(param3,22);
      param1.clear();
      param1.lineStyle(2,param4[2],1,true);
      _loc6_.createGradientBox(param2,param3,Math.PI / 2,0,0);
      param1.beginGradientFill(GradientType.LINEAR,param5 ? [lighten(param4[0]),lighten(param4[1])] : [param4[0],param4[1]],[1,1],[0,255],_loc6_);
      param1.drawRoundRect(0,0,param2,param3,_loc7_,_loc7_);
      param1.endFill();
      param1.lineStyle(0,0,0);
      param1.beginFill(0xFFFFFF,0.35);
      param1.drawRoundRect(3,2,param2 - 6,param3 * 0.42,_loc7_ * 0.7,_loc7_ * 0.7);
      param1.endFill();
   }

   public static function lighten(param1:uint) : uint
   {
      var _loc2_:uint = Math.min(255,(param1 >> 16 & 0xFF) + 28);
      var _loc3_:uint = Math.min(255,(param1 >> 8 & 0xFF) + 28);
      var _loc4_:uint = Math.min(255,(param1 & 0xFF) + 28);
      return _loc2_ << 16 | _loc3_ << 8 | _loc4_;
   }

   // A wooden window with a parchment inside, like the game's popups.
   public static function frame(param1:Graphics, param2:Number, param3:Number) : void
   {
      var _loc4_:Matrix = new Matrix();
      param1.clear();
      param1.lineStyle(3,WOOD_DARK,1,true);
      _loc4_.createGradientBox(param2,param3,Math.PI / 2,0,0);
      param1.beginGradientFill(GradientType.LINEAR,[WOOD_LIGHT,WOOD],[1,1],[0,255],_loc4_);
      param1.drawRoundRect(0,0,param2,param3,26,26);
      param1.endFill();
      param1.lineStyle(2,WOOD_DARK,0.55,true);
      param1.beginFill(PARCH,1);
      param1.drawRoundRect(10,10,param2 - 20,param3 - 20,16,16);
      param1.endFill();
      param1.lineStyle(1,PARCH_LINE,1,true);
      param1.drawRoundRect(14,14,param2 - 28,param3 - 28,12,12);
   }
}

// A game-style button with a text label.
class JRPill extends Sprite
{
   public var key:String;
   public var value:String;
   private var _act:Function;
   private var _w:Number;
   private var _h:Number;
   private var _colors:Array;

   public function JRPill(param1:String, param2:String, param3:Function, param4:String = "normal", param5:Number = 0, param6:int = 11, param7:String = "")
   {
      super();
      key = param2;
      value = param7;
      _act = param3;
      _colors = JRStyle.colors(param4);
      var _loc8_:Boolean = param4 == "plain";
      var _loc9_:TextField = JRStyle.field(param1,param6,_loc8_ ? JRStyle.TEXT : 0xFFFFFF,true);
      if(!_loc8_)
      {
         JRStyle.outline(_loc9_,_colors[2]);
      }
      _w = param5 > 0 ? param5 : Math.ceil(_loc9_.textWidth) + 22;
      _h = param6 + 14;
      draw(false);
      _loc9_.x = Math.round((_w - _loc9_.width) / 2);
      _loc9_.y = Math.round((_h - _loc9_.height) / 2);
      addChild(_loc9_);
      buttonMode = true;
      useHandCursor = true;
      mouseChildren = false;
      addEventListener(MouseEvent.MOUSE_DOWN,onDown);
      addEventListener(MouseEvent.ROLL_OVER,onOver);
      addEventListener(MouseEvent.ROLL_OUT,onOut);
   }

   private function draw(param1:Boolean) : void
   {
      JRStyle.face(graphics,_w,_h,_colors,param1);
   }

   private function onOver(param1:MouseEvent) : void
   {
      draw(true);
   }

   private function onOut(param1:MouseEvent) : void
   {
      draw(false);
   }

   private function onDown(param1:MouseEvent) : void
   {
      param1.stopPropagation();
      if(_act != null)
      {
         _act(this);
      }
   }
}

// Small vector icons for JR's buttons, drawn in the game's style.
class JRIcon
{
   public static function draw(param1:Graphics, param2:String, param3:Number, param4:Number, param5:Number) : void
   {
      var _loc6_:Number = param5;
      var _loc7_:int = 0;
      var _loc8_:Number = NaN;
      if(param2 == "recycle")
      {
         // two arrows chasing each other, with an A for automatic
         param1.lineStyle(_loc6_ * 0.22,0xFFFFFF,1,false,"normal","none");
         param1.moveTo(param3 + _loc6_ * 0.62,param4 - _loc6_ * 0.18);
         param1.curveTo(param3 + _loc6_ * 0.45,param4 - _loc6_ * 0.7,param3 - _loc6_ * 0.05,param4 - _loc6_ * 0.68);
         param1.curveTo(param3 - _loc6_ * 0.52,param4 - _loc6_ * 0.62,param3 - _loc6_ * 0.62,param4 - _loc6_ * 0.12);
         param1.moveTo(param3 - _loc6_ * 0.62,param4 + _loc6_ * 0.18);
         param1.curveTo(param3 - _loc6_ * 0.45,param4 + _loc6_ * 0.7,param3 + _loc6_ * 0.05,param4 + _loc6_ * 0.68);
         param1.curveTo(param3 + _loc6_ * 0.52,param4 + _loc6_ * 0.62,param3 + _loc6_ * 0.62,param4 + _loc6_ * 0.12);
         param1.lineStyle(0,0,0);
         param1.beginFill(0xFFFFFF,1);
         param1.moveTo(param3 - _loc6_ * 0.9,param4 - _loc6_ * 0.2);
         param1.lineTo(param3 - _loc6_ * 0.35,param4 - _loc6_ * 0.2);
         param1.lineTo(param3 - _loc6_ * 0.62,param4 + _loc6_ * 0.18);
         param1.endFill();
         param1.beginFill(0xFFFFFF,1);
         param1.moveTo(param3 + _loc6_ * 0.9,param4 + _loc6_ * 0.2);
         param1.lineTo(param3 + _loc6_ * 0.35,param4 + _loc6_ * 0.2);
         param1.lineTo(param3 + _loc6_ * 0.62,param4 - _loc6_ * 0.18);
         param1.endFill();
         param1.lineStyle(_loc6_ * 0.12,0x1D4E79,1);
         param1.moveTo(param3 - _loc6_ * 0.2,param4 + _loc6_ * 0.25);
         param1.lineTo(param3,param4 - _loc6_ * 0.28);
         param1.lineTo(param3 + _loc6_ * 0.2,param4 + _loc6_ * 0.25);
         param1.moveTo(param3 - _loc6_ * 0.11,param4 + _loc6_ * 0.05);
         param1.lineTo(param3 + _loc6_ * 0.11,param4 + _loc6_ * 0.05);
         return;
      }
      if(param2 == "x")
      {
         param1.lineStyle(_loc6_ * 0.34,0xFFFFFF,1,false,"normal","round");
         param1.moveTo(param3 - _loc6_ * 0.5,param4 - _loc6_ * 0.5);
         param1.lineTo(param3 + _loc6_ * 0.5,param4 + _loc6_ * 0.5);
         param1.moveTo(param3 + _loc6_ * 0.5,param4 - _loc6_ * 0.5);
         param1.lineTo(param3 - _loc6_ * 0.5,param4 + _loc6_ * 0.5);
         return;
      }
      if(param2 == "check")
      {
         param1.lineStyle(_loc6_ * 0.34,0xFFFFFF,1,false,"normal","round","round");
         param1.moveTo(param3 - _loc6_ * 0.6,param4 + _loc6_ * 0.02);
         param1.lineTo(param3 - _loc6_ * 0.15,param4 + _loc6_ * 0.48);
         param1.lineTo(param3 + _loc6_ * 0.62,param4 - _loc6_ * 0.5);
         return;
      }
      if(param2 == "rainbow")
      {
         // a little rainbow: any color at random
         var _loc9_:Array = [0xFF4B4B,0xFFC93C,0x58D25A,0x3D7BFF];
         _loc7_ = 0;
         while(_loc7_ < 4)
         {
            _loc8_ = _loc6_ * (1.15 - _loc7_ * 0.25);
            param1.lineStyle(_loc6_ * 0.24,_loc9_[_loc7_],1,false,"normal","none");
            param1.moveTo(param3 - _loc8_,param4 + _loc6_ * 0.55);
            param1.curveTo(param3 - _loc8_,param4 + _loc6_ * 0.55 - _loc8_,param3,param4 + _loc6_ * 0.55 - _loc8_);
            param1.curveTo(param3 + _loc8_,param4 + _loc6_ * 0.55 - _loc8_,param3 + _loc8_,param4 + _loc6_ * 0.55);
            _loc7_++;
         }
         return;
      }
      if(param2 == "dropper")
      {
         // an eyedropper
         param1.lineStyle(_loc6_ * 0.3,0xFFFFFF,1,false,"normal","round");
         param1.moveTo(param3 - _loc6_ * 0.62,param4 + _loc6_ * 0.62);
         param1.lineTo(param3 + _loc6_ * 0.18,param4 - _loc6_ * 0.18);
         param1.lineStyle(_loc6_ * 0.16,0x1D4E79,1,false,"normal","round");
         param1.moveTo(param3 - _loc6_ * 0.05,param4 - _loc6_ * 0.45);
         param1.lineTo(param3 + _loc6_ * 0.45,param4 + _loc6_ * 0.05);
         param1.lineStyle(0,0,0);
         param1.beginFill(0x1D4E79,1);
         param1.drawCircle(param3 + _loc6_ * 0.42,param4 - _loc6_ * 0.42,_loc6_ * 0.3);
         param1.endFill();
         return;
      }
      if(param2 == "worth")
      {
         // a diamond
         param1.lineStyle(_loc6_ * 0.1,0x1D4E79,1,true);
         param1.beginFill(0xFFFFFF,1);
         param1.moveTo(param3 - _loc6_ * 0.85,param4 - _loc6_ * 0.2);
         param1.lineTo(param3 - _loc6_ * 0.45,param4 - _loc6_ * 0.65);
         param1.lineTo(param3 + _loc6_ * 0.45,param4 - _loc6_ * 0.65);
         param1.lineTo(param3 + _loc6_ * 0.85,param4 - _loc6_ * 0.2);
         param1.lineTo(param3,param4 + _loc6_ * 0.8);
         param1.lineTo(param3 - _loc6_ * 0.85,param4 - _loc6_ * 0.2);
         param1.endFill();
         param1.moveTo(param3 - _loc6_ * 0.85,param4 - _loc6_ * 0.2);
         param1.lineTo(param3 + _loc6_ * 0.85,param4 - _loc6_ * 0.2);
         param1.moveTo(param3 - _loc6_ * 0.3,param4 - _loc6_ * 0.2);
         param1.lineTo(param3,param4 + _loc6_ * 0.8);
         param1.lineTo(param3 + _loc6_ * 0.3,param4 - _loc6_ * 0.2);
         return;
      }
      if(param2 == "den")
      {
         // a couch
         param1.lineStyle(_loc6_ * 0.09,0x1D4E79,1,true);
         param1.beginFill(0xFFD54A,1);
         param1.drawRoundRect(param3 - _loc6_ * 0.62,param4 - _loc6_ * 0.6,_loc6_ * 1.24,_loc6_ * 0.7,_loc6_ * 0.3,_loc6_ * 0.3);
         param1.endFill();
         param1.beginFill(0xFFFFFF,1);
         param1.drawRoundRect(param3 - _loc6_ * 0.95,param4 - _loc6_ * 0.2,_loc6_ * 0.4,_loc6_ * 0.75,_loc6_ * 0.2,_loc6_ * 0.2);
         param1.drawRoundRect(param3 + _loc6_ * 0.55,param4 - _loc6_ * 0.2,_loc6_ * 0.4,_loc6_ * 0.75,_loc6_ * 0.2,_loc6_ * 0.2);
         param1.endFill();
         param1.beginFill(0xFFFFFF,1);
         param1.drawRect(param3 - _loc6_ * 0.55,param4 + _loc6_ * 0.05,_loc6_ * 1.1,_loc6_ * 0.4);
         param1.endFill();
         param1.moveTo(param3 - _loc6_ * 0.75,param4 + _loc6_ * 0.55);
         param1.lineTo(param3 - _loc6_ * 0.75,param4 + _loc6_ * 0.8);
         param1.moveTo(param3 + _loc6_ * 0.75,param4 + _loc6_ * 0.55);
         param1.lineTo(param3 + _loc6_ * 0.75,param4 + _loc6_ * 0.8);
         return;
      }
      if(param2 == "sort")
      {
         // three bars, longest to shortest, and an arrow
         param1.lineStyle(0,0,0);
         param1.beginFill(0xFFFFFF,1);
         param1.drawRoundRect(param3 - _loc6_ * 0.8,param4 - _loc6_ * 0.6,_loc6_ * 1.0,_loc6_ * 0.26,_loc6_ * 0.2,_loc6_ * 0.2);
         param1.drawRoundRect(param3 - _loc6_ * 0.8,param4 - _loc6_ * 0.13,_loc6_ * 0.72,_loc6_ * 0.26,_loc6_ * 0.2,_loc6_ * 0.2);
         param1.drawRoundRect(param3 - _loc6_ * 0.8,param4 + _loc6_ * 0.34,_loc6_ * 0.44,_loc6_ * 0.26,_loc6_ * 0.2,_loc6_ * 0.2);
         param1.endFill();
         param1.beginFill(0xFFD54A,1);
         param1.moveTo(param3 + _loc6_ * 0.5,param4 + _loc6_ * 0.75);
         param1.lineTo(param3 + _loc6_ * 0.2,param4 + _loc6_ * 0.3);
         param1.lineTo(param3 + _loc6_ * 0.4,param4 + _loc6_ * 0.3);
         param1.lineTo(param3 + _loc6_ * 0.4,param4 - _loc6_ * 0.65);
         param1.lineTo(param3 + _loc6_ * 0.6,param4 - _loc6_ * 0.65);
         param1.lineTo(param3 + _loc6_ * 0.6,param4 + _loc6_ * 0.3);
         param1.lineTo(param3 + _loc6_ * 0.8,param4 + _loc6_ * 0.3);
         param1.lineTo(param3 + _loc6_ * 0.5,param4 + _loc6_ * 0.75);
         param1.endFill();
         return;
      }
      if(param2 == "worth")
      {
         // a diamond
         param1.lineStyle(2,0x16598A,1,true);
         param1.beginFill(0xFFFFFF,1);
         param1.moveTo(param3 - _loc6_ * 0.75,param4 - _loc6_ * 0.2);
         param1.lineTo(param3 - _loc6_ * 0.4,param4 - _loc6_ * 0.6);
         param1.lineTo(param3 + _loc6_ * 0.4,param4 - _loc6_ * 0.6);
         param1.lineTo(param3 + _loc6_ * 0.75,param4 - _loc6_ * 0.2);
         param1.lineTo(param3,param4 + _loc6_ * 0.75);
         param1.lineTo(param3 - _loc6_ * 0.75,param4 - _loc6_ * 0.2);
         param1.endFill();
         param1.lineStyle(1,0x16598A,1,true);
         param1.moveTo(param3 - _loc6_ * 0.75,param4 - _loc6_ * 0.2);
         param1.lineTo(param3 + _loc6_ * 0.75,param4 - _loc6_ * 0.2);
         param1.moveTo(param3 - _loc6_ * 0.25,param4 - _loc6_ * 0.6);
         param1.lineTo(param3,param4 + _loc6_ * 0.75);
         param1.lineTo(param3 + _loc6_ * 0.25,param4 - _loc6_ * 0.6);
         return;
      }
      if(param2 == "outfit")
      {
         // a shirt with a plus: save what you're wearing
         param1.lineStyle(2,0x16598A,1,true);
         param1.beginFill(0xFFFFFF,1);
         param1.moveTo(param3 - _loc6_ * 0.3,param4 - _loc6_ * 0.65);
         param1.lineTo(param3 - _loc6_ * 0.8,param4 - _loc6_ * 0.35);
         param1.lineTo(param3 - _loc6_ * 0.6,param4 - _loc6_ * 0.05);
         param1.lineTo(param3 - _loc6_ * 0.45,param4 - _loc6_ * 0.15);
         param1.lineTo(param3 - _loc6_ * 0.45,param4 + _loc6_ * 0.7);
         param1.lineTo(param3 + _loc6_ * 0.45,param4 + _loc6_ * 0.7);
         param1.lineTo(param3 + _loc6_ * 0.45,param4 - _loc6_ * 0.15);
         param1.lineTo(param3 + _loc6_ * 0.6,param4 - _loc6_ * 0.05);
         param1.lineTo(param3 + _loc6_ * 0.8,param4 - _loc6_ * 0.35);
         param1.lineTo(param3 + _loc6_ * 0.3,param4 - _loc6_ * 0.65);
         param1.curveTo(param3,param4 - _loc6_ * 0.4,param3 - _loc6_ * 0.3,param4 - _loc6_ * 0.65);
         param1.endFill();
         param1.lineStyle(_loc6_ * 0.16,0x45A82A,1,false,"normal","none");
         param1.moveTo(param3,param4 - _loc6_ * 0.05);
         param1.lineTo(param3,param4 + _loc6_ * 0.5);
         param1.moveTo(param3 - _loc6_ * 0.27,param4 + _loc6_ * 0.22);
         param1.lineTo(param3 + _loc6_ * 0.27,param4 + _loc6_ * 0.22);
         return;
      }
      if(param2 == "tryon")
      {
         // a hanger
         param1.lineStyle(_loc6_ * 0.13,0xFFFFFF,1,true);
         param1.moveTo(param3 - _loc6_ * 0.12,param4 - _loc6_ * 0.45);
         param1.curveTo(param3 - _loc6_ * 0.12,param4 - _loc6_ * 0.72,param3 + _loc6_ * 0.08,param4 - _loc6_ * 0.72);
         param1.curveTo(param3 + _loc6_ * 0.25,param4 - _loc6_ * 0.68,param3 + _loc6_ * 0.12,param4 - _loc6_ * 0.48);
         param1.lineTo(param3,param4 - _loc6_ * 0.3);
         param1.lineTo(param3 - _loc6_ * 0.85,param4 + _loc6_ * 0.3);
         param1.lineTo(param3 + _loc6_ * 0.85,param4 + _loc6_ * 0.3);
         param1.lineTo(param3,param4 - _loc6_ * 0.3);
         param1.lineStyle(0,0,0);
         param1.beginFill(0xFFD54A,1);
         param1.drawCircle(param3 + _loc6_ * 0.5,param4 + _loc6_ * 0.6,_loc6_ * 0.22);
         param1.endFill();
         return;
      }
      if(param2 == "glow")
      {
         // a sparkle
         param1.lineStyle(2,0xB3008F,1,true);
         param1.beginFill(0xFF6FD8,1);
         param1.moveTo(param3,param4 - _loc6_ * 0.85);
         param1.curveTo(param3 + _loc6_ * 0.12,param4 - _loc6_ * 0.12,param3 + _loc6_ * 0.85,param4);
         param1.curveTo(param3 + _loc6_ * 0.12,param4 + _loc6_ * 0.12,param3,param4 + _loc6_ * 0.85);
         param1.curveTo(param3 - _loc6_ * 0.12,param4 + _loc6_ * 0.12,param3 - _loc6_ * 0.85,param4);
         param1.curveTo(param3 - _loc6_ * 0.12,param4 - _loc6_ * 0.12,param3,param4 - _loc6_ * 0.85);
         param1.endFill();
         param1.lineStyle(0,0,0);
         param1.beginFill(0xFFFFFF,0.9);
         param1.drawCircle(param3 + _loc6_ * 0.5,param4 - _loc6_ * 0.5,_loc6_ * 0.13);
         param1.endFill();
         return;
      }
      if(param2 == "adventure")
      {
         // a flag on a hill
         param1.lineStyle(2,0x4A2810,1,true);
         param1.beginFill(0x7BC043,1);
         param1.moveTo(param3 - _loc6_ * 0.8,param4 + _loc6_ * 0.7);
         param1.curveTo(param3,param4 + _loc6_ * 0.1,param3 + _loc6_ * 0.8,param4 + _loc6_ * 0.7);
         param1.lineTo(param3 - _loc6_ * 0.8,param4 + _loc6_ * 0.7);
         param1.endFill();
         param1.beginFill(0x8A5228,1);
         param1.drawRect(param3 - _loc6_ * 0.06,param4 - _loc6_ * 0.75,_loc6_ * 0.12,_loc6_ * 1.15);
         param1.endFill();
         param1.beginFill(0xE53935,1);
         param1.moveTo(param3 + _loc6_ * 0.06,param4 - _loc6_ * 0.75);
         param1.lineTo(param3 + _loc6_ * 0.7,param4 - _loc6_ * 0.52);
         param1.lineTo(param3 + _loc6_ * 0.06,param4 - _loc6_ * 0.28);
         param1.lineTo(param3 + _loc6_ * 0.06,param4 - _loc6_ * 0.75);
         param1.endFill();
         return;
      }
      if(param2 == "picture")
      {
         // a framed landscape
         param1.lineStyle(2,0x4A2810,1,true);
         param1.beginFill(0xC98A4B,1);
         param1.drawRoundRect(param3 - _loc6_ * 0.8,param4 - _loc6_ * 0.62,_loc6_ * 1.6,_loc6_ * 1.24,_loc6_ * 0.2,_loc6_ * 0.2);
         param1.endFill();
         param1.lineStyle(1,0x4A2810,1,true);
         param1.beginFill(0x9FE0FA,1);
         param1.drawRect(param3 - _loc6_ * 0.6,param4 - _loc6_ * 0.44,_loc6_ * 1.2,_loc6_ * 0.88);
         param1.endFill();
         param1.lineStyle(0,0,0);
         param1.beginFill(0x5DAE3B,1);
         param1.moveTo(param3 - _loc6_ * 0.6,param4 + _loc6_ * 0.44);
         param1.lineTo(param3 - _loc6_ * 0.18,param4 - _loc6_ * 0.08);
         param1.lineTo(param3 + _loc6_ * 0.12,param4 + _loc6_ * 0.2);
         param1.lineTo(param3 + _loc6_ * 0.3,param4);
         param1.lineTo(param3 + _loc6_ * 0.6,param4 + _loc6_ * 0.44);
         param1.endFill();
         param1.beginFill(0xFFD54A,1);
         param1.drawCircle(param3 + _loc6_ * 0.3,param4 - _loc6_ * 0.22,_loc6_ * 0.12);
         param1.endFill();
         return;
      }
      if(param2 == "ad")
      {
         // a megaphone
         param1.lineStyle(2,0x1D4E79,1,true);
         param1.beginFill(0xFFFFFF,1);
         param1.moveTo(param3 - _loc6_ * 0.55,param4 - _loc6_ * 0.18);
         param1.lineTo(param3 + _loc6_ * 0.35,param4 - _loc6_ * 0.55);
         param1.lineTo(param3 + _loc6_ * 0.35,param4 + _loc6_ * 0.55);
         param1.lineTo(param3 - _loc6_ * 0.55,param4 + _loc6_ * 0.18);
         param1.lineTo(param3 - _loc6_ * 0.55,param4 - _loc6_ * 0.18);
         param1.endFill();
         param1.beginFill(0xFFD54A,1);
         param1.drawRect(param3 - _loc6_ * 0.75,param4 - _loc6_ * 0.2,_loc6_ * 0.22,_loc6_ * 0.4);
         param1.endFill();
         param1.lineStyle(2,0xFFFFFF,1);
         param1.moveTo(param3 + _loc6_ * 0.5,param4 - _loc6_ * 0.3);
         param1.lineTo(param3 + _loc6_ * 0.7,param4 - _loc6_ * 0.45);
         param1.moveTo(param3 + _loc6_ * 0.52,param4);
         param1.lineTo(param3 + _loc6_ * 0.78,param4);
         param1.moveTo(param3 + _loc6_ * 0.5,param4 + _loc6_ * 0.3);
         param1.lineTo(param3 + _loc6_ * 0.7,param4 + _loc6_ * 0.45);
      }
      else if(param2 == "rooms")
      {
         // a signpost
         param1.lineStyle(2,0x4A2810,1,true);
         param1.beginFill(0x9C6633,1);
         param1.drawRect(param3 - _loc6_ * 0.07,param4 - _loc6_ * 0.6,_loc6_ * 0.14,_loc6_ * 1.3);
         param1.endFill();
         param1.beginFill(0xFFE6A8,1);
         param1.moveTo(param3 - _loc6_ * 0.55,param4 - _loc6_ * 0.5);
         param1.lineTo(param3 + _loc6_ * 0.45,param4 - _loc6_ * 0.5);
         param1.lineTo(param3 + _loc6_ * 0.68,param4 - _loc6_ * 0.3);
         param1.lineTo(param3 + _loc6_ * 0.45,param4 - _loc6_ * 0.1);
         param1.lineTo(param3 - _loc6_ * 0.55,param4 - _loc6_ * 0.1);
         param1.lineTo(param3 - _loc6_ * 0.55,param4 - _loc6_ * 0.5);
         param1.endFill();
         param1.beginFill(0xFFE6A8,1);
         param1.moveTo(param3 + _loc6_ * 0.5,param4 + _loc6_ * 0.02);
         param1.lineTo(param3 - _loc6_ * 0.45,param4 + _loc6_ * 0.02);
         param1.lineTo(param3 - _loc6_ * 0.68,param4 + _loc6_ * 0.22);
         param1.lineTo(param3 - _loc6_ * 0.45,param4 + _loc6_ * 0.42);
         param1.lineTo(param3 + _loc6_ * 0.5,param4 + _loc6_ * 0.42);
         param1.lineTo(param3 + _loc6_ * 0.5,param4 + _loc6_ * 0.02);
         param1.endFill();
      }
   }
}

// A round button like the game's toolbar buttons: wooden ring, white rim,
// blue face. Shows an icon or a short word.
class JRRound extends Sprite
{
   public var key:String;
   public var local:Boolean;
   private var _act:Function;
   private var _d:Number;
   private var _face:Shape;

   private var _tip:Sprite;

   private var _tipText:String;

   // param6: a name shown on hover (icon buttons have no words on them).
   public function JRRound(param1:String, param2:String, param3:String, param4:Number, param5:Function, param6:String = "")
   {
      super();
      key = param1;
      _act = param5;
      _d = param4;
      _tipText = param6;
      _face = new Shape();
      addChild(_face);
      paint(false);
      var _loc6_:Shape = new Shape();
      if(param2 != "")
      {
         JRIcon.draw(_loc6_.graphics,param2,_d / 2,_d / 2,_d * 0.32);
         addChild(_loc6_);
      }
      else
      {
         var _loc7_:TextField = JRStyle.outline(JRStyle.field(param3,Math.round(_d * 0.36),0xFFFFFF,true),0x16598A);
         _loc7_.x = Math.round((_d - _loc7_.width) / 2);
         _loc7_.y = Math.round((_d - _loc7_.height) / 2);
         addChild(_loc7_);
      }
      buttonMode = true;
      useHandCursor = true;
      mouseChildren = false;
      addEventListener(MouseEvent.MOUSE_DOWN,onDown);
      addEventListener(MouseEvent.ROLL_OVER,onOver);
      addEventListener(MouseEvent.ROLL_OUT,onOut);
   }

   private function paint(param1:Boolean) : void
   {
      var _loc2_:Graphics = _face.graphics;
      var _loc3_:Matrix = new Matrix();
      var _loc4_:Number = _d / 2;
      _loc2_.clear();
      _loc3_.createGradientBox(_d,_d,Math.PI / 2,0,0);
      _loc2_.lineStyle(2,JRStyle.WOOD_DARK,1,true);
      _loc2_.beginGradientFill(GradientType.LINEAR,[JRStyle.WOOD_LIGHT,JRStyle.WOOD],[1,1],[0,255],_loc3_);
      _loc2_.drawCircle(_loc4_,_loc4_,_loc4_);
      _loc2_.endFill();
      _loc2_.lineStyle(0,0,0);
      _loc2_.beginFill(0xFFFFFF,1);
      _loc2_.drawCircle(_loc4_,_loc4_,_loc4_ * 0.8);
      _loc2_.endFill();
      _loc3_.createGradientBox(_d * 0.7,_d * 0.7,Math.PI / 2,_d * 0.15,_d * 0.15);
      _loc2_.lineStyle(1,0x16598A,1,true);
      _loc2_.beginGradientFill(GradientType.LINEAR,param1 ? [0xB5ECFF,0x48B4EC] : [0x93DEF8,0x2B98D6],[1,1],[0,255],_loc3_);
      _loc2_.drawCircle(_loc4_,_loc4_,_loc4_ * 0.7);
      _loc2_.endFill();
      _loc2_.lineStyle(0,0,0);
      _loc2_.beginFill(0xFFFFFF,0.35);
      _loc2_.drawEllipse(_loc4_ - _loc4_ * 0.45,_loc4_ - _loc4_ * 0.62,_loc4_ * 0.9,_loc4_ * 0.5);
      _loc2_.endFill();
   }

   private function onOver(param1:MouseEvent) : void
   {
      paint(true);
      if(_tipText != "" && _tip == null)
      {
         var _loc2_:TextField = JRStyle.field(_tipText,11,0xFFFFFF,true);
         _tip = new Sprite();
         _tip.graphics.beginFill(0x1D4E79,0.92);
         _tip.graphics.drawRoundRect(0,0,_loc2_.width + 12,_loc2_.height + 4,8,8);
         _tip.graphics.endFill();
         _loc2_.x = 6;
         _loc2_.y = 2;
         _tip.addChild(_loc2_);
         _tip.mouseEnabled = false;
         _tip.mouseChildren = false;
         _tip.x = Math.round((_d - _tip.width) / 2);
         _tip.y = -_tip.height - 4;
      }
      if(_tip != null)
      {
         addChild(_tip);
      }
   }

   private function onOut(param1:MouseEvent) : void
   {
      paint(false);
      if(_tip != null && _tip.parent == this)
      {
         removeChild(_tip);
      }
   }

   private function onDown(param1:MouseEvent) : void
   {
      param1.stopPropagation();
      if(_act != null)
      {
         _act(this);
      }
   }
}

// A tab for the World Map's side window, copied from the map's own tab art
// with JR's icon painted over the old one.
class JRMapTab extends Sprite
{
   public var key:String;
   private var _act:Function;

   public function JRMapTab(param1:String, param2:DisplayObject, param3:String, param4:Function)
   {
      super();
      key = param1;
      _act = param4;
      var _loc5_:Rectangle = param2.getBounds(param2);
      var _loc6_:BitmapData = new BitmapData(Math.max(1,Math.ceil(_loc5_.width)),Math.max(1,Math.ceil(_loc5_.height)),true,0);
      var _loc7_:Matrix = new Matrix();
      _loc7_.translate(-_loc5_.x,-_loc5_.y);
      _loc6_.draw(param2,_loc7_);
      var _loc8_:Bitmap = new Bitmap(_loc6_);
      _loc8_.smoothing = true;
      addChild(_loc8_);
      // The inner color, read from beside the old icon, covers it.
      var _loc9_:uint = _loc6_.getPixel(Math.round(_loc6_.width * 0.24),Math.round(_loc6_.height * 0.24));
      var _loc10_:uint = _loc6_.getPixel(Math.round(_loc6_.width * 0.24),Math.round(_loc6_.height * 0.78));
      var _loc11_:Shape = new Shape();
      var _loc12_:Matrix = new Matrix();
      var _loc13_:Number = _loc6_.width * 0.18;
      var _loc14_:Number = _loc6_.height * 0.18;
      _loc12_.createGradientBox(_loc6_.width - _loc13_ * 2,_loc6_.height - _loc14_ * 2,Math.PI / 2,_loc13_,_loc14_);
      _loc11_.graphics.beginGradientFill(GradientType.LINEAR,[_loc9_,_loc10_],[1,1],[0,255],_loc12_);
      _loc11_.graphics.drawRoundRect(_loc13_,_loc14_,_loc6_.width - _loc13_ * 2,_loc6_.height - _loc14_ * 2,14,14);
      _loc11_.graphics.endFill();
      JRIcon.draw(_loc11_.graphics,param3,_loc6_.width * 0.5,_loc6_.height * 0.5,Math.min(_loc6_.width,_loc6_.height) * 0.36);
      addChild(_loc11_);
      x = param2.x + _loc5_.x * param2.scaleX;
      y = param2.y + _loc5_.y * param2.scaleY;
      buttonMode = true;
      useHandCursor = true;
      mouseChildren = false;
      addEventListener(MouseEvent.MOUSE_DOWN,onDown);
      addEventListener(MouseEvent.ROLL_OVER,onOver);
      addEventListener(MouseEvent.ROLL_OUT,onOut);
   }

   // Moves with the game's own tab (the side window slides in and out).
   public function follow(param1:DisplayObject, param2:Number) : void
   {
      var _loc6_:JRMapTab = this;
      var _loc7_:DisplayObject = param1;
      var _loc3_:Number = x - param1.x;
      var _loc4_:Number = y - param1.y + param2;
      var _loc5_:Function = function(param1x:Event):void
      {
         _loc6_.x = _loc7_.x + _loc3_;
         _loc6_.y = _loc7_.y + _loc4_;
         _loc6_.visible = _loc7_.visible;
      };
      addEventListener(Event.ENTER_FRAME,_loc5_);
      _loc5_(null);
   }

   public function set lit(param1:Boolean) : void
   {
      transform.colorTransform = param1 ? new ColorTransform(1.08,1.08,1.08,1,18,18,18) : new ColorTransform();
   }

   private function onOver(param1:MouseEvent) : void
   {
      lit = true;
   }

   private function onOut(param1:MouseEvent) : void
   {
      lit = false;
   }

   private function onDown(param1:MouseEvent) : void
   {
      param1.stopPropagation();
      if(_act != null)
      {
         _act(param1);
      }
   }
}

// The row of JR buttons JR adds to a game screen.
class JRBar extends Sprite
{
   public var anchorId:String;
   public var ctx:Object;

   // param4 > 0: round buttons that size, like the game's toolbar buttons.
   public function JRBar(param1:String, param2:Array, param3:Object, param4:Number = 0)
   {
      super();
      anchorId = param1;
      ctx = param3;
      name = "jrBar_" + param1;
      var _loc4_:Number = 0;
      var _loc5_:Object = null;
      var _loc6_:Sprite = null;
      for each(_loc5_ in param2)
      {
         if(param4 > 0)
         {
            _loc6_ = new JRRound(String(_loc5_.local || _loc5_.id),_loc5_.i ? String(_loc5_.i) : "",_loc5_.i ? "" : String(_loc5_.l),param4,onPick,_loc5_.i ? String(_loc5_.l) : "");
            Object(_loc6_).local = !!_loc5_.local;
         }
         else
         {
            _loc6_ = new JRPill(String(_loc5_.l),String(_loc5_.id),onPick,_loc5_.s ? String(_loc5_.s) : "normal",0,12);
         }
         _loc6_.x = _loc4_;
         addChild(_loc6_);
         _loc4_ += _loc6_.width + (param4 > 0 ? 6 : 5);
      }
      addEventListener(MouseEvent.MOUSE_DOWN,swallow);
   }

   private function swallow(param1:MouseEvent) : void
   {
      param1.stopPropagation();
   }

   private function onPick(param1:Object) : void
   {
      if(param1 is JRRound && JRRound(param1).local)
      {
         XtReplyDemuxer.jrRunLocal(param1.key,param1 as DisplayObject);
         return;
      }
      XtReplyDemuxer.jrOpen(param1.key,anchorId,ctx,param1 as DisplayObject);
   }
}

// A short message at the top of the game, on a parchment banner.
class JRToast extends Sprite
{
   private var _left:int;

   public function JRToast(param1:String, param2:String)
   {
      super();
      mouseEnabled = false;
      mouseChildren = false;
      var _loc3_:TextField = JRStyle.field(param1,13,param2 ? JRStyle.tone(param2) : JRStyle.TEXT,true,380,"center");
      _loc3_.x = 16;
      _loc3_.y = 10;
      addChild(_loc3_);
      graphics.lineStyle(3,JRStyle.WOOD_DARK,1,true);
      graphics.beginFill(0xFBF0D2,0.98);
      graphics.drawRoundRect(0,0,412,_loc3_.height + 20,22,22);
      graphics.endFill();
      graphics.lineStyle(1,JRStyle.PARCH_LINE,1,true);
      graphics.drawRoundRect(4,4,404,_loc3_.height + 12,16,16);
      filters = [new DropShadowFilter(3,90,0,0.4,8,8,1,2)];
      _left = 150;
      addEventListener(Event.ENTER_FRAME,onFrame);
   }

   private function onFrame(param1:Event) : void
   {
      _left--;
      if(_left < 20)
      {
         alpha = _left / 20;
      }
      if(_left <= 0)
      {
         removeEventListener(Event.ENTER_FRAME,onFrame);
         if(parent)
         {
            parent.removeChild(this);
         }
      }
   }
}

class JRSwatch extends Sprite
{
   public var key:String;
   public var color:String;
   private var _act:Function;

   public function JRSwatch(param1:String, param2:String, param3:Boolean, param4:Function)
   {
      super();
      key = param1;
      color = param2;
      _act = param4;
      var _loc5_:uint = uint(parseInt(param2.replace("#",""),16));
      graphics.lineStyle(param3 ? 3 : 2,param3 ? 0x2B98D6 : JRStyle.WOOD_DARK,1,true);
      graphics.beginFill(_loc5_,1);
      graphics.drawRoundRect(0,0,24,24,8,8);
      graphics.endFill();
      buttonMode = true;
      useHandCursor = true;
      addEventListener(MouseEvent.MOUSE_DOWN,onDown);
   }

   private function onDown(param1:MouseEvent) : void
   {
      param1.stopPropagation();
      _act(this);
   }
}

// One JR window: framed like the game's popups, or set into one of the
// game's own windows (embed).
class JRPanel extends Sprite
{
   public var id:String;
   private var _w:Number = 340;
   private var _maxH:Number = 380;
   private var _embedded:Boolean;
   private var _head:Sprite;
   private var _body:Sprite;
   private var _content:Sprite;
   private var _mask:Shape;
   private var _thumb:Sprite;
   private var _scroll:Number = 0;
   private var _contentH:Number = 0;
   private var _viewH:Number = 0;
   private var _inputs:Object = {};
   private var _orig:Object = {};
   private var _keep:Object;
   private var _refocus:String;
   private var _placed:Boolean;
   private var _dragFrom:Number;
   private var _dragScroll:Number;

   public function JRPanel(param1:String)
   {
      super();
      id = param1;
      _head = new Sprite();
      _body = new Sprite();
      _content = new Sprite();
      _mask = new Shape();
      _thumb = new Sprite();
      addChild(_body);
      addChild(_head);
      _body.addChild(_content);
      _body.addChild(_mask);
      _body.addChild(_thumb);
      _content.mask = _mask;
      _head.addEventListener(MouseEvent.MOUSE_DOWN,onHeadDown);
      addEventListener(MouseEvent.MOUSE_DOWN,swallow);
      addEventListener(MouseEvent.MOUSE_WHEEL,onWheel);
      _thumb.buttonMode = true;
      _thumb.addEventListener(MouseEvent.MOUSE_DOWN,onThumbDown);
   }

   public function get embedded() : Boolean
   {
      return _embedded;
   }

   private function swallow(param1:Event) : void
   {
      param1.stopPropagation();
   }

   // Sets this window into a game window, filling w by h.
   public function embed(param1:DisplayObjectContainer, param2:Number, param3:Number, param4:Number, param5:Number) : void
   {
      _embedded = true;
      _w = param4;
      _maxH = param5;
      x = param2;
      y = param3;
      param1.addChild(this);
   }

   public function show(param1:Stage, param2:Object, param3:DisplayObject) : void
   {
      var _loc4_:Rectangle = null;
      if(_embedded)
      {
         render(param2);
         return;
      }
      render(param2);
      param1.addChild(this);
      if(!_placed)
      {
         _placed = true;
         if(param3 != null && param3.stage != null)
         {
            _loc4_ = param3.getBounds(param1);
            x = _loc4_.left + _loc4_.width / 2 - _w / 2;
            y = _loc4_.bottom > param1.stageHeight / 2 ? _loc4_.top - height - 6 : _loc4_.bottom + 18;
         }
         else
         {
            x = (param1.stageWidth - _w) / 2;
            y = 70;
         }
      }
      clamp();
   }

   private function clamp() : void
   {
      if(stage == null || _embedded)
      {
         return;
      }
      if(x + _w > stage.stageWidth - 4)
      {
         x = stage.stageWidth - 4 - _w;
      }
      if(y + height > stage.stageHeight - 4)
      {
         y = stage.stageHeight - 4 - height;
      }
      if(x < 4)
      {
         x = 4;
      }
      if(y < 20)
      {
         y = 20;
      }
      x = Math.round(x);
      y = Math.round(y);
   }

   public function close() : void
   {
      if(parent)
      {
         parent.removeChild(this);
      }
   }

   private function onHeadDown(param1:MouseEvent) : void
   {
      if(_embedded || param1.target is JRRound || param1.target is JRPill)
      {
         return;
      }
      startDrag();
      stage.addEventListener(MouseEvent.MOUSE_UP,onHeadUp);
   }

   private function onHeadUp(param1:MouseEvent) : void
   {
      stopDrag();
      if(stage)
      {
         stage.removeEventListener(MouseEvent.MOUSE_UP,onHeadUp);
      }
      clamp();
   }

   private function onWheel(param1:MouseEvent) : void
   {
      param1.stopPropagation();
      scrollTo(_scroll - param1.delta * 12);
   }

   private function onThumbDown(param1:MouseEvent) : void
   {
      param1.stopPropagation();
      _dragFrom = stage.mouseY;
      _dragScroll = _scroll;
      stage.addEventListener(MouseEvent.MOUSE_MOVE,onThumbMove);
      stage.addEventListener(MouseEvent.MOUSE_UP,onThumbUp);
   }

   private function onThumbMove(param1:MouseEvent) : void
   {
      var _loc2_:Number = _viewH - _thumb.height;
      if(_loc2_ > 0)
      {
         scrollTo(_dragScroll + (stage.mouseY - _dragFrom) / _loc2_ * (_contentH - _viewH));
      }
   }

   private function onThumbUp(param1:MouseEvent) : void
   {
      stage.removeEventListener(MouseEvent.MOUSE_MOVE,onThumbMove);
      stage.removeEventListener(MouseEvent.MOUSE_UP,onThumbUp);
   }

   private function scrollTo(param1:Number) : void
   {
      var _loc2_:Number = Math.max(0,_contentH - _viewH);
      _scroll = Math.max(0,Math.min(_loc2_,param1));
      _content.y = -Math.round(_scroll);
      if(_loc2_ > 0)
      {
         _thumb.y = Math.round(_scroll / _loc2_ * (_viewH - _thumb.height));
      }
   }

   private function send(param1:String, param2:String) : void
   {
      var _loc3_:Object = {};
      var _loc4_:String = null;
      for(_loc4_ in _inputs)
      {
         _loc3_[_loc4_] = TextField(_inputs[_loc4_]).text;
      }
      XtReplyDemuxer.jrPanelEvent(id,param1,param2,_loc3_);
   }

   private function onPill(param1:Object) : void
   {
      send(param1.key,param1.value);
   }

   private function onClose(param1:Object) : void
   {
      close();
      send("_close","");
   }

   public function render(param1:Object) : void
   {
      var _loc2_:Number = NaN;
      var _loc3_:TextField = null;
      var _loc4_:JRPill = null;
      var _loc5_:Object = null;
      var _loc6_:Number = NaN;
      var _loc7_:Number = NaN;
      var _loc8_:Sprite = null;
      var _loc9_:Number = NaN;
      var _loc10_:String = null;
      var _loc11_:Number = NaN;
      if(!_embedded)
      {
         _w = param1.w ? Number(param1.w) : 340;
         _maxH = param1.h ? Number(param1.h) : 380;
      }
      // Text you're typing survives JR redrawing the window.
      _keep = {};
      _refocus = null;
      for(_loc10_ in _inputs)
      {
         if(TextField(_inputs[_loc10_]).text != _orig[_loc10_])
         {
            _keep[_loc10_] = TextField(_inputs[_loc10_]).text;
         }
         if(stage && stage.focus == _inputs[_loc10_])
         {
            _refocus = _loc10_;
         }
      }
      _inputs = {};
      _orig = {};
      while(_head.numChildren)
      {
         _head.removeChildAt(0);
      }
      while(_content.numChildren)
      {
         _content.removeChildAt(0);
      }
      _content.graphics.clear();
      _head.graphics.clear();
      _loc9_ = _embedded ? 0 : 26;
      if(_embedded)
      {
         _loc2_ = 0;
      }
      else
      {
         // Title on a parchment banner across the top edge, close button on the corner.
         _loc3_ = JRStyle.field(String(param1.title || "JR").toUpperCase(),16,JRStyle.WOOD_DARK,true);
         _loc8_ = new Sprite();
         _loc6_ = Math.max(140,_loc3_.width + 56);
         _loc8_.graphics.lineStyle(3,JRStyle.WOOD_DARK,1,true);
         _loc8_.graphics.beginFill(0xFBF0D2,1);
         _loc8_.graphics.drawRoundRect(0,0,_loc6_,34,34,34);
         _loc8_.graphics.endFill();
         _loc8_.graphics.lineStyle(2,0xE8A94A,1,true);
         _loc8_.graphics.drawRoundRect(4,4,_loc6_ - 8,26,26,26);
         _loc3_.x = Math.round((_loc6_ - _loc3_.width) / 2);
         _loc3_.y = Math.round((34 - _loc3_.height) / 2);
         _loc8_.addChild(_loc3_);
         _loc8_.x = Math.round((_w - _loc6_) / 2);
         _loc8_.y = -14;
         _loc8_.mouseChildren = false;
         _head.addChild(_loc8_);
         var _loc12_:JRRound = new JRRound("_close","","X",34,onClose);
         _loc12_.x = _w - 26;
         _loc12_.y = -12;
         _head.addChild(_loc12_);
         _loc2_ = 30;
         if(param1.sub)
         {
            _loc3_ = JRStyle.field(String(param1.sub),11,JRStyle.DIM,false,_w - 2 * _loc9_,"center");
            _loc3_.x = _loc9_;
            _loc3_.y = _loc2_;
            _head.addChild(_loc3_);
            _loc2_ += _loc3_.height + 4;
         }
      }
      if(param1.tabs is Array)
      {
         _loc6_ = _loc9_;
         _loc7_ = _loc2_;
         for each(_loc5_ in param1.tabs)
         {
            _loc4_ = new JRPill(String(_loc5_.l),"_tab",onPill,String(_loc5_.id) == String(param1.tab) ? "normal" : "plain",0,11,String(_loc5_.id));
            if(_loc6_ + _loc4_.width > _w - _loc9_)
            {
               _loc6_ = _loc9_;
               _loc7_ += _loc4_.height + 4;
            }
            _loc4_.x = _loc6_;
            _loc4_.y = _loc7_;
            _head.addChild(_loc4_);
            _loc6_ += _loc4_.width + 4;
         }
         _loc2_ = _loc7_ + 32;
      }
      _head.graphics.beginFill(0,0);
      _head.graphics.drawRect(0,-14,_w,_loc2_ + 14);
      _head.graphics.endFill();
      _contentH = layout(param1.rows is Array ? param1.rows as Array : [],_w - 2 * _loc9_ - 10);
      if(param1.foot)
      {
         _loc3_ = JRStyle.field(String(param1.foot),10,JRStyle.DIM,false,_w - 2 * _loc9_ - 10);
         _loc3_.y = _contentH + 4;
         _content.addChild(_loc3_);
         _contentH += _loc3_.height + 8;
      }
      _viewH = _embedded ? _maxH : Math.min(_contentH,_maxH);
      _body.x = _loc9_;
      _body.y = _loc2_;
      _mask.graphics.clear();
      _mask.graphics.beginFill(0,1);
      _mask.graphics.drawRect(-4,-2,_w - 2 * _loc9_ + 4,_viewH + 4);
      _mask.graphics.endFill();
      _thumb.graphics.clear();
      _thumb.visible = _contentH > _viewH;
      if(_thumb.visible)
      {
         _thumb.graphics.lineStyle(1,JRStyle.WOOD_DARK,1,true);
         _thumb.graphics.beginFill(JRStyle.WOOD_LIGHT,1);
         _thumb.graphics.drawRoundRect(0,0,7,Math.max(24,_viewH * _viewH / _contentH),7,7);
         _thumb.graphics.endFill();
         _thumb.x = _w - 2 * _loc9_ - 4;
      }
      if(_refocus != null && _inputs[_refocus] && stage)
      {
         stage.focus = TextField(_inputs[_refocus]);
      }
      graphics.clear();
      if(!_embedded)
      {
         JRStyle.frame(graphics,_w,_loc2_ + _viewH + 22);
         filters = [new DropShadowFilter(4,90,0,0.45,12,12,1,2)];
      }
      scrollTo(_scroll);
      clamp();
   }

   // Lays out the rows _loc3_ wide; returns their height.
   private function layout(param1:Array, param2:Number) : Number
   {
      var _loc2_:Number = 0;
      var _loc3_:Number = param2;
      var _loc4_:Object = null;
      var _loc5_:TextField = null;
      var _loc6_:JRPill = null;
      var _loc7_:Number = NaN;
      var _loc8_:Number = NaN;
      var _loc9_:Object = null;
      var _loc10_:Sprite = null;
      var _loc11_:Number = NaN;
      var _loc12_:int = 0;
      var _loc13_:TextField = null;
      var _loc14_:int = 0;
      for each(_loc4_ in param1)
      {
         if(_loc4_ == null)
         {
            continue;
         }
         switch(String(_loc4_.t))
         {
            case "h":
               _loc2_ += _loc2_ > 0 ? 6 : 0;
               _loc5_ = JRStyle.field(String(_loc4_.text),13,JRStyle.WOOD_DARK,true,_loc3_);
               _loc5_.y = _loc2_;
               _content.addChild(_loc5_);
               _loc2_ += _loc5_.height + 4;
               break;
            case "p":
               _loc5_ = JRStyle.field(String(_loc4_.text),11,JRStyle.tone(String(_loc4_.c)),!!_loc4_.b,_loc3_);
               _loc5_.y = _loc2_;
               _content.addChild(_loc5_);
               _loc2_ += _loc5_.height + 4;
               break;
            case "kv":
               _loc5_ = JRStyle.field(String(_loc4_.k),12,JRStyle.DIM,true);
               _loc5_.y = _loc2_;
               _content.addChild(_loc5_);
               _loc13_ = JRStyle.field(String(_loc4_.v),12,JRStyle.tone(String(_loc4_.c)),true,0,"right");
               _loc13_.x = _loc3_ - _loc13_.width;
               _loc13_.y = _loc2_;
               _content.addChild(_loc13_);
               _loc2_ += Math.max(_loc5_.height,_loc13_.height) + 2;
               break;
            case "sep":
               _content.graphics.lineStyle(2,JRStyle.PARCH_LINE,1);
               _content.graphics.moveTo(0,_loc2_ + 5);
               _content.graphics.lineTo(_loc3_,_loc2_ + 5);
               _loc2_ += 12;
               break;
            case "btn":
               _loc6_ = new JRPill(String(_loc4_.label),String(_loc4_.id),onPill,_loc4_.style ? String(_loc4_.style) : "normal",_loc3_,12,_loc4_.v != null ? String(_loc4_.v) : "");
               _loc6_.y = _loc2_;
               _content.addChild(_loc6_);
               _loc2_ += _loc6_.height + 6;
               break;
            case "row":
               _loc9_ = _loc4_.items;
               if(_loc9_ is Array && (_loc9_ as Array).length)
               {
                  _loc7_ = (_loc3_ - 6 * ((_loc9_ as Array).length - 1)) / (_loc9_ as Array).length;
                  _loc8_ = 0;
                  for each(_loc4_ in _loc9_)
                  {
                     _loc6_ = new JRPill(String(_loc4_.label),String(_loc4_.id),onPill,_loc4_.style ? String(_loc4_.style) : "normal",_loc7_,11,_loc4_.v != null ? String(_loc4_.v) : "");
                     _loc6_.x = _loc8_;
                     _loc6_.y = _loc2_;
                     _content.addChild(_loc6_);
                     _loc8_ += _loc7_ + 6;
                  }
                  _loc2_ += 31;
               }
               break;
            case "tog":
               _loc2_ += addToggle(_loc4_,_loc2_,_loc3_);
               break;
            case "in":
               _loc2_ += addInput(_loc4_,_loc2_,_loc3_);
               break;
            case "chips":
               _loc7_ = 0;
               _loc8_ = _loc2_;
               if(_loc4_.label)
               {
                  _loc5_ = JRStyle.field(String(_loc4_.label),11,JRStyle.DIM,true);
                  _loc5_.y = _loc8_;
                  _content.addChild(_loc5_);
                  _loc8_ += _loc5_.height + 2;
               }
               for each(_loc9_ in _loc4_.opts)
               {
                  _loc6_ = new JRPill(String(_loc9_.l),String(_loc4_.id),onPill,String(_loc9_.v) == String(_loc4_.v) ? "normal" : "plain",0,10,String(_loc9_.v));
                  if(_loc7_ + _loc6_.width > _loc3_)
                  {
                     _loc7_ = 0;
                     _loc8_ += _loc6_.height + 4;
                  }
                  _loc6_.x = _loc7_;
                  _loc6_.y = _loc8_;
                  _content.addChild(_loc6_);
                  _loc7_ += _loc6_.width + 4;
               }
               _loc2_ = _loc8_ + 28;
               break;
            case "sw":
               _loc12_ = 0;
               _loc11_ = 24;
               _loc14_ = Math.max(1,Math.floor(_loc3_ / (_loc11_ + 4)));
               for each(_loc9_ in _loc4_.colors)
               {
                  _loc10_ = new JRSwatch(String(_loc4_.id),String(_loc9_),String(_loc9_).toLowerCase() == String(_loc4_.v).toLowerCase(),onSwatch);
                  _loc10_.x = _loc12_ % _loc14_ * (_loc11_ + 4);
                  _loc10_.y = _loc2_ + Math.floor(_loc12_ / _loc14_) * (_loc11_ + 4);
                  _content.addChild(_loc10_);
                  _loc12_++;
               }
               _loc2_ += Math.ceil(_loc12_ / _loc14_) * (_loc11_ + 4) + 4;
               break;
            case "num":
               _loc5_ = JRStyle.field(String(_loc4_.label),11,JRStyle.TEXT,false,_loc3_ - 112);
               _loc5_.y = _loc2_ + 5;
               _content.addChild(_loc5_);
               _loc6_ = new JRPill("-",String(_loc4_.id),onPill,"normal",28,11,String(Number(_loc4_.v) - (_loc4_.step ? Number(_loc4_.step) : 1)));
               _loc6_.x = _loc3_ - 104;
               _loc6_.y = _loc2_;
               _content.addChild(_loc6_);
               _loc13_ = JRStyle.field(String(_loc4_.v),12,JRStyle.WOOD_DARK,true,44,"center");
               _loc13_.x = _loc3_ - 74;
               _loc13_.y = _loc2_ + 4;
               _content.addChild(_loc13_);
               _loc6_ = new JRPill("+",String(_loc4_.id),onPill,"normal",28,11,String(Number(_loc4_.v) + (_loc4_.step ? Number(_loc4_.step) : 1)));
               _loc6_.x = _loc3_ - 28;
               _loc6_.y = _loc2_;
               _content.addChild(_loc6_);
               _loc2_ += Math.max(31,_loc5_.height + 10);
               break;
            case "li":
               _loc2_ += addItem(_loc4_,_loc2_,_loc3_);
               break;
         }
      }
      return _loc2_;
   }

   private function addToggle(param1:Object, param2:Number, param3:Number) : Number
   {
      var _loc4_:Boolean = param1.v == true;
      var _loc5_:TextField = JRStyle.field(String(param1.label),12,JRStyle.TEXT,true,param3 - 62);
      _loc5_.y = param2 + 3;
      _content.addChild(_loc5_);
      var _loc7_:Number = _loc5_.height + 6;
      if(param1.sub)
      {
         var _loc8_:TextField = JRStyle.field(String(param1.sub),10,JRStyle.DIM,false,param3 - 62);
         _loc8_.y = param2 + 3 + _loc5_.height;
         _content.addChild(_loc8_);
         _loc7_ += _loc8_.height;
      }
      var _loc6_:JRPill = new JRPill(_loc4_ ? "ON" : "OFF",String(param1.id),onPill,_loc4_ ? "primary" : "plain",54,11,_loc4_ ? "0" : "1");
      _loc6_.x = param3 - 54;
      _loc6_.y = param2 + 2;
      _content.addChild(_loc6_);
      return Math.max(30,_loc7_);
   }

   private function addInput(param1:Object, param2:Number, param3:Number) : Number
   {
      var _loc4_:Number = param2;
      var _loc5_:TextField = null;
      if(param1.label)
      {
         _loc5_ = JRStyle.field(String(param1.label),11,JRStyle.DIM,true,param3);
         _loc5_.y = _loc4_;
         _content.addChild(_loc5_);
         _loc4_ += _loc5_.height + 2;
      }
      var _loc6_:Number = param1.go ? param3 - 74 : param3;
      var _loc10_:Number = param1.lines ? 16 * Number(param1.lines) + 8 : 26;
      var _loc7_:Sprite = new Sprite();
      _loc7_.graphics.lineStyle(2,JRStyle.WOOD,1,true);
      _loc7_.graphics.beginFill(0xFFFFFF,1);
      _loc7_.graphics.drawRoundRect(0,0,_loc6_,_loc10_,10,10);
      _loc7_.graphics.endFill();
      _loc7_.y = _loc4_;
      _content.addChild(_loc7_);
      var _loc8_:TextField = new TextField();
      _loc8_.defaultTextFormat = new TextFormat("Verdana",12,JRStyle.TEXT);
      _loc8_.type = TextFieldType.INPUT;
      _loc8_.multiline = !!param1.lines;
      _loc8_.wordWrap = !!param1.lines;
      _loc8_.x = 6;
      _loc8_.y = _loc4_ + 4;
      _loc8_.width = _loc6_ - 12;
      _loc8_.height = _loc10_ - 6;
      if(param1.max)
      {
         _loc8_.maxChars = int(param1.max);
      }
      _loc8_.text = param1.v != null ? String(param1.v) : "";
      _orig[String(param1.id)] = _loc8_.text;
      if(_keep[String(param1.id)] != null)
      {
         _loc8_.text = String(_keep[String(param1.id)]);
      }
      _loc8_.name = String(param1.id);
      _loc8_.addEventListener(KeyboardEvent.KEY_DOWN,onKey);
      _loc8_.addEventListener(KeyboardEvent.KEY_UP,swallow);
      _content.addChild(_loc8_);
      _inputs[String(param1.id)] = _loc8_;
      if(param1.go)
      {
         var _loc9_:JRPill = new JRPill(String(param1.go),String(param1.id),onInputGo,"normal",68);
         _loc9_.x = param3 - 68;
         _loc9_.y = _loc4_ + 1;
         _content.addChild(_loc9_);
      }
      _loc4_ += _loc10_ + 6;
      return _loc4_ - param2;
   }

   private function onInputGo(param1:JRPill) : void
   {
      var _loc2_:TextField = _inputs[param1.key] as TextField;
      if(_loc2_)
      {
         _orig[param1.key] = _loc2_.text;
      }
      send(param1.key,_loc2_ ? _loc2_.text : "");
   }

   private function onKey(param1:KeyboardEvent) : void
   {
      param1.stopPropagation();
      var _loc2_:TextField = param1.currentTarget as TextField;
      if(param1.keyCode == 13 && _loc2_ && !_loc2_.multiline)
      {
         _orig[_loc2_.name] = _loc2_.text;
         send(_loc2_.name,_loc2_.text);
      }
   }

   private function onSwatch(param1:JRSwatch) : void
   {
      send(param1.key,param1.color);
   }

   private function addItem(param1:Object, param2:Number, param3:Number) : Number
   {
      var _loc4_:Sprite = new Sprite();
      var _loc5_:Number = param3;
      // ic: the item's picture, drawn by the game (JRItemIcon), left of the text.
      var _loc16_:Number = param1.ic ? (param1.ic.s ? Number(param1.ic.s) : 36) : 0;
      var _loc17_:Number = _loc16_ > 0 ? _loc16_ + 10 : 0;
      var _loc6_:Array = param1.btns is Array ? param1.btns as Array : [];
      var _loc7_:Number = _loc5_ - 16 - _loc17_;
      var _loc8_:Object = null;
      var _loc9_:JRPill = null;
      var _loc10_:Array = [];
      for each(_loc8_ in _loc6_)
      {
         _loc9_ = new JRPill(String(_loc8_.label),String(_loc8_.id),onPill,_loc8_.style ? String(_loc8_.style) : "normal",0,10,_loc8_.v != null ? String(_loc8_.v) : "");
         _loc7_ -= _loc9_.width + 4;
         _loc10_.push(_loc9_);
      }
      var _loc11_:TextField = null;
      if(param1.right != null)
      {
         _loc11_ = JRStyle.field(String(param1.right),11,JRStyle.tone(param1.rc ? String(param1.rc) : "ok"),true,0,"right");
         _loc7_ -= _loc11_.width + 6;
      }
      var _loc12_:TextField = JRStyle.field(String(param1.text),12,JRStyle.tone(param1.c ? String(param1.c) : ""),true,Math.max(60,_loc7_));
      _loc12_.x = 9 + _loc17_;
      _loc12_.y = 5;
      _loc4_.addChild(_loc12_);
      var _loc13_:Number = _loc12_.height + 10;
      if(param1.sub)
      {
         var _loc14_:TextField = JRStyle.field(String(param1.sub),10,JRStyle.DIM,false,Math.max(60,_loc7_));
         _loc14_.x = 9 + _loc17_;
         _loc14_.y = 5 + _loc12_.height;
         _loc4_.addChild(_loc14_);
         _loc13_ += _loc14_.height;
      }
      _loc13_ = Math.max(_loc13_,32,_loc16_ + 8);
      if(_loc16_ > 0)
      {
         var _loc18_:JRItemIcon = new JRItemIcon(param1.ic,_loc16_);
         _loc18_.x = 6;
         _loc18_.y = Math.round((_loc13_ - _loc16_) / 2);
         _loc4_.addChild(_loc18_);
         if(_loc14_ != null)
         {
            _loc14_.y = Math.round((_loc13_ - _loc12_.height - _loc14_.height) / 2) + _loc12_.height;
         }
         _loc12_.y = _loc14_ != null ? _loc14_.y - _loc12_.height : Math.round((_loc13_ - _loc12_.height) / 2);
      }
      var _loc15_:Number = _loc5_ - 4;
      for each(_loc9_ in _loc10_)
      {
         _loc15_ -= _loc9_.width + 4;
         _loc9_.x = _loc15_ + 4;
         _loc9_.y = Math.round((_loc13_ - _loc9_.height) / 2);
         _loc4_.addChild(_loc9_);
      }
      if(_loc11_ != null)
      {
         _loc11_.x = _loc15_ - 2 - _loc11_.width;
         _loc11_.y = Math.round((_loc13_ - _loc11_.height) / 2);
         _loc4_.addChild(_loc11_);
      }
      _loc4_.graphics.lineStyle(1,JRStyle.ROW_EDGE,1,true);
      _loc4_.graphics.beginFill(param1.sel ? JRStyle.ROW_SEL : JRStyle.ROW,1);
      _loc4_.graphics.drawRoundRect(0,0,_loc5_,_loc13_,12,12);
      _loc4_.graphics.endFill();
      if(param1.id)
      {
         _loc4_.buttonMode = true;
         _loc4_.name = String(param1.id);
         _loc4_.addEventListener(MouseEvent.MOUSE_DOWN,onItem);
      }
      _loc4_.y = param2;
      _content.addChild(_loc4_);
      return _loc13_ + 5;
   }

   private function onItem(param1:MouseEvent) : void
   {
      if(param1.target is JRPill)
      {
         return;
      }
      send(Sprite(param1.currentTarget).name,"");
   }
}

// Art Studio: turns a picture from your computer into a painting on the
// canvas, ready for Create Den Item, Send to AJ, or saving as .ajart.
class JRPicturePopup extends Sprite
{
   private var _cw:int;
   private var _ch:int;
   private var _apply:Function;
   private var _source:BitmapData;
   private var _result:BitmapData;
   private var _fit:String = "fill";
   private var _preview:Bitmap;
   private var _note:TextField;
   private var _buttons:Sprite;
   private var _file:FileReference;
   private var _w:Number = 470;
   private var _h:Number = 420;

   public function JRPicturePopup(param1:int, param2:int, param3:Function)
   {
      super();
      _cw = param1;
      _ch = param2;
      _apply = param3;
      addEventListener(MouseEvent.MOUSE_DOWN,swallow);
      JRStyle.frame(graphics,_w,_h);
      filters = [new DropShadowFilter(4,90,0,0.45,12,12,1,2)];
      var _loc4_:TextField = JRStyle.field("PICTURE TO MASTERPIECE",16,JRStyle.WOOD_DARK,true);
      var _loc5_:Sprite = new Sprite();
      var _loc6_:Number = _loc4_.width + 56;
      _loc5_.graphics.lineStyle(3,JRStyle.WOOD_DARK,1,true);
      _loc5_.graphics.beginFill(0xFBF0D2,1);
      _loc5_.graphics.drawRoundRect(0,0,_loc6_,34,34,34);
      _loc5_.graphics.endFill();
      _loc5_.graphics.lineStyle(2,0xE8A94A,1,true);
      _loc5_.graphics.drawRoundRect(4,4,_loc6_ - 8,26,26,26);
      _loc4_.x = 28;
      _loc4_.y = Math.round((34 - _loc4_.height) / 2);
      _loc5_.addChild(_loc4_);
      _loc5_.x = Math.round((_w - _loc6_) / 2);
      _loc5_.y = -14;
      addChild(_loc5_);
      var _loc7_:JRRound = new JRRound("_close","","X",34,onClose);
      _loc7_.x = _w - 26;
      _loc7_.y = -12;
      addChild(_loc7_);
      // the preview, in the canvas's shape
      var _loc8_:Sprite = new Sprite();
      var _loc9_:Number = _w - 60;
      var _loc10_:Number = Math.round(_loc9_ * _ch / _cw);
      _loc8_.graphics.lineStyle(3,JRStyle.WOOD,1,true);
      _loc8_.graphics.beginFill(0xFFFFFF,1);
      _loc8_.graphics.drawRect(0,0,_loc9_,_loc10_);
      _loc8_.graphics.endFill();
      _loc8_.x = 30;
      _loc8_.y = 34;
      addChild(_loc8_);
      _preview = new Bitmap(null,"auto",true);
      _loc8_.addChild(_preview);
      _note = JRStyle.field("Choose a picture from your computer.",12,JRStyle.DIM,true,_loc9_ - 20,"center");
      _note.x = 10;
      _note.y = _loc10_ / 2 - 10;
      _loc8_.addChild(_note);
      _buttons = new Sprite();
      _buttons.x = 30;
      _buttons.y = 34 + _loc10_ + 12;
      addChild(_buttons);
      drawButtons();
   }

   private function swallow(param1:Event) : void
   {
      param1.stopPropagation();
   }

   private function drawButtons() : void
   {
      var _loc1_:Number = _w - 60;
      var _loc2_:JRPill = null;
      var _loc3_:Number = 0;
      var _loc4_:Array = [["fill","Fill"],["fit","Fit"],["stretch","Stretch"]];
      var _loc5_:Array = null;
      while(_buttons.numChildren)
      {
         _buttons.removeChildAt(0);
      }
      _loc2_ = new JRPill("Choose a picture","choose",onChoose,"normal",150,12);
      _buttons.addChild(_loc2_);
      _loc3_ = 160;
      for each(_loc5_ in _loc4_)
      {
         _loc2_ = new JRPill(_loc5_[1],_loc5_[0],onFit,_fit == _loc5_[0] ? "normal" : "plain",(_loc1_ - 160 - 8) / 3 - 1,11);
         _loc2_.x = _loc3_;
         _buttons.addChild(_loc2_);
         _loc3_ += _loc2_.width + 4;
      }
      _loc2_ = new JRPill("Put it on the canvas","apply",onApply,_result ? "primary" : "plain",(_loc1_ - 8) / 2,12);
      _loc2_.y = 36;
      _buttons.addChild(_loc2_);
      _loc2_ = new JRPill("Save as .ajart file","save",onApply,_result ? "primary" : "plain",(_loc1_ - 8) / 2,12);
      _loc2_.x = (_loc1_ + 8) / 2;
      _loc2_.y = 36;
      _buttons.addChild(_loc2_);
      var _loc6_:TextField = JRStyle.field("Fill crops the edges, Fit keeps the whole picture. Then use Create Den Item or Send to AJ like any painting.",10,JRStyle.DIM,false,_loc1_,"center");
      _loc6_.y = 70;
      _buttons.addChild(_loc6_);
   }

   private function onChoose(param1:Object) : void
   {
      _file = new FileReference();
      _file.addEventListener(Event.SELECT,onSelect);
      _file.browse([new FileFilter("Pictures (*.jpg, *.png, *.gif)","*.jpg;*.jpeg;*.png;*.gif")]);
   }

   private function onSelect(param1:Event) : void
   {
      _note.text = "Loading…";
      _file.addEventListener(Event.COMPLETE,onFileLoaded);
      _file.load();
   }

   private function onFileLoaded(param1:Event) : void
   {
      var _loc2_:Loader = new Loader();
      _loc2_.contentLoaderInfo.addEventListener(Event.COMPLETE,onDecoded);
      _loc2_.contentLoaderInfo.addEventListener("ioError",onBad);
      try
      {
         _loc2_.loadBytes(_file.data);
      }
      catch(e:Error)
      {
         onBad(null);
      }
   }

   private function onBad(param1:Event) : void
   {
      _note.text = "That picture couldn't be opened. Try a .jpg or .png.";
      _note.visible = true;
   }

   private function onDecoded(param1:Event) : void
   {
      var _loc2_:Bitmap = LoaderInfo(param1.target).content as Bitmap;
      if(_loc2_ == null)
      {
         onBad(null);
         return;
      }
      _source = _loc2_.bitmapData;
      _note.visible = false;
      compose();
   }

   private function onFit(param1:Object) : void
   {
      _fit = String(param1.key);
      compose();
   }

   // The picture at the canvas's size, the way Fill / Fit / Stretch says.
   private function compose() : void
   {
      var _loc1_:Matrix = new Matrix();
      var _loc2_:Number = NaN;
      var _loc3_:Number = NaN;
      if(_source != null)
      {
         _result = new BitmapData(_cw,_ch,false,0xFFFFFF);
         if(_fit == "stretch")
         {
            _loc1_.scale(_cw / _source.width,_ch / _source.height);
         }
         else
         {
            _loc2_ = _fit == "fill" ? Math.max(_cw / _source.width,_ch / _source.height) : Math.min(_cw / _source.width,_ch / _source.height);
            _loc1_.scale(_loc2_,_loc2_);
            _loc1_.translate((_cw - _source.width * _loc2_) / 2,(_ch - _source.height * _loc2_) / 2);
         }
         _result.draw(_source,_loc1_,null,null,null,true);
         _preview.bitmapData = _result;
         _preview.smoothing = true;
         _loc3_ = (_w - 60) / _cw;
         _preview.scaleX = _preview.scaleY = _loc3_;
      }
      drawButtons();
   }

   private function onApply(param1:Object) : void
   {
      if(_result == null)
      {
         return;
      }
      _apply(_result,String(param1.key) == "save");
      close();
   }

   private function onClose(param1:Object) : void
   {
      close();
   }

   public function close() : void
   {
      if(parent)
      {
         parent.removeChild(this);
      }
   }
}


// A drop-down list of ways to sort, under the button that opened it.
class JRSortMenu extends Sprite
{
   public static const OPTIONS:Array = [["newest","Newest first"],["oldest","Oldest first"],["az","Name A to Z"],["za","Name Z to A"],["worth","Most valuable"],["worthlow","Least valuable"],["rare","Rares first"],["diamond","Diamond items first"],["members","Members items first"],["dupes","Most copies first"],["color","By color"]];
   private var _pick:Function;
   // The game's own list this one sits beside: when it hides, this closes.
   public var follow:DisplayObject = null;

   public function JRSortMenu(param1:String, param2:Function, param3:Array = null)
   {
      super();
      _pick = param2;
      var _loc4_:Array = param3 || OPTIONS;
      var _loc5_:Number = 186;
      var _loc6_:TextField = JRStyle.field("MORE SORTS",13,JRStyle.WOOD_DARK,true);
      _loc6_.x = Math.round((_loc5_ - _loc6_.width) / 2);
      _loc6_.y = 12;
      addChild(_loc6_);
      var _loc7_:Number = 36;
      var _loc8_:Array = null;
      var _loc9_:JRPill = null;
      for each(_loc8_ in _loc4_)
      {
         _loc9_ = new JRPill(String(_loc8_[1]),String(_loc8_[0]),onPick,String(_loc8_[0]) == param1 ? "normal" : "plain",_loc5_ - 28,11);
         _loc9_.x = 14;
         _loc9_.y = _loc7_;
         addChild(_loc9_);
         _loc7_ += _loc9_.height + 4;
      }
      JRStyle.frame(graphics,_loc5_,_loc7_ + 12);
      filters = [new DropShadowFilter(4,90,0,0.45,12,12,1,2)];
      addEventListener(MouseEvent.MOUSE_DOWN,swallow);
      addEventListener(Event.ADDED_TO_STAGE,onAdded);
   }

   private function swallow(param1:Event) : void
   {
      param1.stopPropagation();
   }

   private function onAdded(param1:Event) : void
   {
      stage.addEventListener(MouseEvent.MOUSE_DOWN,onStageDown,false,0,true);
      addEventListener(Event.ENTER_FRAME,onFrame);
   }

   private function onFrame(param1:Event) : void
   {
      if(follow != null && (!follow.visible || follow.stage == null))
      {
         close();
      }
   }

   // Clicking anywhere else closes the list.
   private function onStageDown(param1:MouseEvent) : void
   {
      close();
   }

   private function onPick(param1:Object) : void
   {
      close();
      _pick(String(param1.key));
   }

   public function close() : void
   {
      removeEventListener(Event.ENTER_FRAME,onFrame);
      if(stage)
      {
         stage.removeEventListener(MouseEvent.MOUSE_DOWN,onStageDown);
      }
      if(parent)
      {
         parent.removeChild(this);
      }
   }
}

// A small game button with an icon (Edit Animal's color tools).
class JRMiniBtn extends Sprite
{
   private var _w:Number;
   private var _h:Number;
   private var _tone:String;
   private var _act:Function;
   private var _face:Shape;
   private var _lit:Boolean = false;

   public function JRMiniBtn(param1:String, param2:Number, param3:Number, param4:String, param5:Function)
   {
      super();
      _w = param2;
      _h = param3;
      _tone = param4;
      _act = param5;
      _face = new Shape();
      addChild(_face);
      paint(false);
      var _loc6_:Shape = new Shape();
      JRIcon.draw(_loc6_.graphics,param1,_w / 2,_h / 2,_h * 0.36);
      addChild(_loc6_);
      buttonMode = true;
      useHandCursor = true;
      mouseChildren = false;
      addEventListener(MouseEvent.MOUSE_DOWN,onDown);
      addEventListener(MouseEvent.ROLL_OVER,onOver);
      addEventListener(MouseEvent.ROLL_OUT,onOut);
   }

   public function set lit(param1:Boolean) : void
   {
      _lit = param1;
      paint(false);
   }

   private function paint(param1:Boolean) : void
   {
      var _loc2_:Array = JRStyle.colors(_lit ? "primary" : _tone);
      var _loc3_:Graphics = _face.graphics;
      var _loc4_:Matrix = new Matrix();
      var _loc5_:Number = _w / 2;
      if(_w != _h)
      {
         JRStyle.face(_loc3_,_w,_h,_loc2_,param1);
         return;
      }
      // square buttons are round, like the game's close and check buttons
      _loc3_.clear();
      _loc3_.lineStyle(2,_loc2_[2],1,true);
      _loc4_.createGradientBox(_w,_h,Math.PI / 2,0,0);
      _loc3_.beginGradientFill(GradientType.LINEAR,param1 ? [JRStyle.lighten(_loc2_[0]),JRStyle.lighten(_loc2_[1])] : [_loc2_[0],_loc2_[1]],[1,1],[0,255],_loc4_);
      _loc3_.drawCircle(_loc5_,_loc5_,_loc5_);
      _loc3_.endFill();
      _loc3_.lineStyle(0,0,0);
      _loc3_.beginFill(0xFFFFFF,0.35);
      _loc3_.drawEllipse(_loc5_ * 0.45,_loc5_ * 0.18,_loc5_ * 1.1,_loc5_ * 0.7);
      _loc3_.endFill();
   }

   private function onOver(param1:MouseEvent) : void
   {
      paint(true);
   }

   private function onOut(param1:MouseEvent) : void
   {
      paint(false);
   }

   private function onDown(param1:MouseEvent) : void
   {
      param1.stopPropagation();
      _act();
   }
}

// Under each Edit Animal color table: the color code (type one and press the
// check or Enter for the closest game color), a random color, and an
// eyedropper that takes the color of whatever you click next.
class JRColorRow extends Sprite
{
   private var _t:Object;
   private var _pal:Array;
   private var _n:int;
   private var _hex:TextField;
   private var _drop:JRMiniBtn;
   private var _stage:Stage;
   private var _picker:JRColorPicker;
   private var _hsv:Array;

   public function JRColorRow(param1:Object, param2:Array, param3:int)
   {
      super();
      _t = param1;
      _pal = param2;
      _n = param3;
      var _loc4_:Sprite = new Sprite();
      _loc4_.graphics.lineStyle(1,0x8A6434,1,true);
      _loc4_.graphics.beginFill(0xFFFFFF,1);
      _loc4_.graphics.drawRect(0,0,70,20);
      _loc4_.graphics.endFill();
      addChild(_loc4_);
      _hex = new TextField();
      _hex.defaultTextFormat = new TextFormat("Verdana",12,JRStyle.TEXT);
      _hex.type = TextFieldType.INPUT;
      _hex.maxChars = 7;
      _hex.restrict = "#0-9a-fA-F";
      _hex.x = 2;
      _hex.y = 1;
      _hex.width = 67;
      _hex.height = 19;
      _hex.addEventListener(KeyboardEvent.KEY_DOWN,onKey);
      _hex.addEventListener(KeyboardEvent.KEY_UP,swallow);
      addChild(_hex);
      var _loc5_:JRMiniBtn = new JRMiniBtn("check",20,20,"primary",onApply);
      _loc5_.x = 75;
      addChild(_loc5_);
      var _loc6_:JRMiniBtn = new JRMiniBtn("rainbow",30,20,"normal",onWheel);
      _loc6_.x = 99;
      addChild(_loc6_);
      _drop = new JRMiniBtn("dropper",30,20,"normal",onDropper);
      _drop.x = 133;
      addChild(_drop);
      var _loc7_:TextField = JRStyle.field("or pick one",11,JRStyle.TEXT);
      _loc7_.x = 168;
      _loc7_.y = 2;
      addChild(_loc7_);
      addEventListener(MouseEvent.MOUSE_DOWN,swallow);
      addEventListener(Event.REMOVED_FROM_STAGE,onGone);
   }

   public function update() : void
   {
      if(stage && stage.focus == _hex)
      {
         return;
      }
      var _loc1_:int = int(_t.jrColor);
      var _loc3_:int = XtReplyDemuxer.jrTrueFor(int(_t.jrId),_loc1_);
      var _loc2_:String = (_loc3_ >= 0 ? uint(_loc3_) : uint(_pal[_loc1_]) & 0xFFFFFF).toString(16).toUpperCase();
      while(_loc2_.length < 6)
      {
         _loc2_ = "0" + _loc2_;
      }
      _hex.textColor = JRStyle.TEXT;
      _hex.text = "#" + _loc2_;
   }

   // The game color that best keeps a color's hue and vividness: the hue
   // counts most on vivid colors, and a duller match costs more than a
   // brighter one, so bright picks stay bright.
   private function nearest(param1:uint) : int
   {
      var _loc2_:Array = JRColorRow.hsvOf(param1);
      var _loc3_:int = 0;
      var _loc4_:Number = Number.MAX_VALUE;
      var _loc5_:int = 0;
      var _loc6_:Array = null;
      var _loc7_:Number = NaN;
      var _loc8_:Number = NaN;
      var _loc9_:Number = NaN;
      var _loc10_:Number = NaN;
      var _loc11_:Number = _loc2_[1] * _loc2_[2];
      if(_hsv == null)
      {
         _hsv = [];
         while(_loc5_ < _n)
         {
            _hsv.push(JRColorRow.hsvOf(uint(_pal[_loc5_]) & 0xFFFFFF));
            _loc5_++;
         }
         _loc5_ = 0;
      }
      while(_loc5_ < _n)
      {
         _loc6_ = _hsv[_loc5_];
         _loc7_ = Math.abs(_loc2_[0] - _loc6_[0]);
         _loc7_ = Math.min(_loc7_,360 - _loc7_) / 60;
         _loc8_ = _loc2_[1] - _loc6_[1];
         _loc9_ = _loc2_[2] - _loc6_[2];
         _loc10_ = _loc7_ * _loc7_ * _loc11_ * Math.min(1,_loc6_[1] * _loc6_[2] * 3) * 3 + _loc8_ * _loc8_ * (_loc8_ > 0 ? 3 : 1) + _loc9_ * _loc9_ * (_loc9_ > 0 ? 2 : 1);
         if(_loc10_ < _loc4_)
         {
            _loc4_ = _loc10_;
            _loc3_ = _loc5_;
         }
         _loc5_++;
      }
      return _loc3_;
   }

   // [hue 0-360, saturation 0-1, brightness 0-1]
   public static function hsvOf(param1:uint) : Array
   {
      var _loc2_:Number = (param1 >> 16 & 0xFF) / 255;
      var _loc3_:Number = (param1 >> 8 & 0xFF) / 255;
      var _loc4_:Number = (param1 & 0xFF) / 255;
      var _loc5_:Number = Math.max(_loc2_,_loc3_,_loc4_);
      var _loc6_:Number = _loc5_ - Math.min(_loc2_,_loc3_,_loc4_);
      var _loc7_:Number = 0;
      if(_loc6_ > 0)
      {
         if(_loc5_ == _loc2_)
         {
            _loc7_ = 60 * (((_loc3_ - _loc4_) / _loc6_ + 6) % 6);
         }
         else if(_loc5_ == _loc3_)
         {
            _loc7_ = 60 * ((_loc4_ - _loc2_) / _loc6_ + 2);
         }
         else
         {
            _loc7_ = 60 * ((_loc2_ - _loc3_) / _loc6_ + 4);
         }
      }
      return [_loc7_,_loc5_ > 0 ? _loc6_ / _loc5_ : 0,_loc5_];
   }

   private function choose(param1:int) : void
   {
      _t.jrSelect(param1);
      if(stage && stage.focus == _hex)
      {
         stage.focus = null;
      }
      update();
   }

   private function onApply() : void
   {
      var _loc1_:String = _hex.text.replace(/#/g,"");
      if(_loc1_.length == 3)
      {
         _loc1_ = _loc1_.charAt(0) + _loc1_.charAt(0) + _loc1_.charAt(1) + _loc1_.charAt(1) + _loc1_.charAt(2) + _loc1_.charAt(2);
      }
      if(!/^[0-9a-fA-F]{6}$/.test(_loc1_))
      {
         _hex.textColor = JRStyle.BAD;
         return;
      }
      choose(nearest(uint(parseInt(_loc1_,16))));
   }

   // The rainbow button: the Pick a Color window (JRColorPicker).
   private function onWheel() : void
   {
      if(stage == null)
      {
         return;
      }
      stopPicking();
      if(_picker)
      {
         _picker.close();
      }
      var _loc1_:int = XtReplyDemuxer.jrTrueFor(int(_t.jrId),int(_t.jrColor));
      _picker = new JRColorPicker(_loc1_ >= 0 ? uint(_loc1_) : uint(_pal[int(_t.jrColor)]) & 0xFFFFFF,snapRgb,onPicked,_loc1_ >= 0 || JRColorPicker.trueByDefault);
      _picker.x = Math.round((stage.stageWidth - JRColorPicker.W) / 2);
      _picker.y = Math.round((stage.stageHeight - JRColorPicker.H) / 2);
      stage.addChild(_picker);
   }

   private function snapRgb(param1:uint) : uint
   {
      return uint(_pal[nearest(param1)]) & 0xFFFFFF;
   }

   // param1: the game color, param2: the exact color, param3: True color on.
   private function onPicked(param1:uint, param2:uint, param3:Boolean) : void
   {
      _picker = null;
      if(stage)
      {
         var _loc4_:int = nearest(param1);
         XtReplyDemuxer.jrSetTrue(int(_t.jrId),_loc4_,param3 ? int(param2) : -1);
         choose(_loc4_);
      }
   }

   private function onDropper() : void
   {
      if(_stage)
      {
         stopPicking();
         return;
      }
      if(stage == null)
      {
         return;
      }
      _stage = stage;
      _stage.addEventListener(MouseEvent.MOUSE_DOWN,onPick,true,100);
      _drop.lit = true;
   }

   private function onPick(param1:MouseEvent) : void
   {
      param1.stopImmediatePropagation();
      var _loc2_:Stage = _stage;
      stopPicking();
      if(_drop.contains(param1.target as DisplayObject))
      {
         return;
      }
      var _loc3_:int = JRColorPicker.sample(_loc2_);
      if(_loc3_ < 0)
      {
         _hex.textColor = JRStyle.BAD;
         return;
      }
      choose(nearest(uint(_loc3_)));
   }

   private function stopPicking() : void
   {
      if(_stage)
      {
         _stage.removeEventListener(MouseEvent.MOUSE_DOWN,onPick,true);
         _stage = null;
      }
      _drop.lit = false;
   }

   private function onGone(param1:Event) : void
   {
      stopPicking();
      if(_picker)
      {
         _picker.close();
         _picker = null;
      }
   }

   private function swallow(param1:Event) : void
   {
      param1.stopPropagation();
   }

   private function onKey(param1:KeyboardEvent) : void
   {
      param1.stopPropagation();
      if(param1.keyCode == 13)
      {
         onApply();
      }
   }
}

// A game button with a word and an icon (Pick a Color's Pick, Cancel and Set).
class JRTextBtn extends Sprite
{
   private var _w:Number;
   private var _h:Number;
   private var _tone:String;
   private var _act:Function;
   private var _face:Shape;
   private var _lit:Boolean = false;

   public function JRTextBtn(param1:String, param2:String, param3:Boolean, param4:Number, param5:Number, param6:String, param7:Function)
   {
      super();
      _w = param4;
      _h = param5;
      _tone = param6;
      _act = param7;
      _face = new Shape();
      addChild(_face);
      paint(false);
      var _loc8_:Array = JRStyle.colors(param6);
      var _loc9_:TextField = JRStyle.outline(JRStyle.field(param1,Math.round(_h * 0.56),0xFFFFFF,true),_loc8_[2]);
      var _loc10_:Shape = new Shape();
      var _loc11_:Number = _h * 0.3;
      if(param3)
      {
         JRIcon.draw(_loc10_.graphics,param2,_h * 0.7,_h / 2,_loc11_);
         _loc9_.x = Math.round(_h * 0.7 + (_w - _h * 0.7 - _loc9_.width) / 2);
      }
      else
      {
         JRIcon.draw(_loc10_.graphics,param2,_w - _h * 0.7,_h / 2,_loc11_);
         _loc9_.x = Math.round((_w - _h * 0.9 - _loc9_.width) / 2);
      }
      _loc9_.y = Math.round((_h - _loc9_.height) / 2);
      addChild(_loc10_);
      addChild(_loc9_);
      buttonMode = true;
      useHandCursor = true;
      mouseChildren = false;
      addEventListener(MouseEvent.MOUSE_DOWN,onDown);
      addEventListener(MouseEvent.ROLL_OVER,onOver);
      addEventListener(MouseEvent.ROLL_OUT,onOut);
   }

   public function set lit(param1:Boolean) : void
   {
      _lit = param1;
      paint(false);
   }

   private function paint(param1:Boolean) : void
   {
      JRStyle.face(_face.graphics,_w,_h,JRStyle.colors(_lit ? "primary" : _tone),param1);
   }

   private function onOver(param1:MouseEvent) : void
   {
      paint(true);
   }

   private function onOut(param1:MouseEvent) : void
   {
      paint(false);
   }

   private function onDown(param1:MouseEvent) : void
   {
      param1.stopPropagation();
      _act();
   }
}

// Pick a Color: a color square and a rainbow strip, New and Before, the color
// code, an eyedropper (Pick), Cancel and Set. New shows the closest color the
// game has, which is what Set gives your animal.
class JRColorPicker extends Sprite
{
   public static const W:int = 360;
   public static const H:int = 290;
   private static const BORDER:uint = 0x8A5228;
   private var _snap:Function;
   private var _done:Function;
   private var _hue:Number = 0;
   private var _sat:Number = 0;
   private var _val:Number = 0;
   private var _result:uint = 0;
   private var _sv:Shape;
   private var _svArea:Sprite;
   private var _mark:Shape;
   private var _hueArea:Sprite;
   private var _handle:Shape;
   private var _newBox:Shape;
   private var _hex:TextField;
   private var _pick:JRTextBtn;
   private var _drag:String = null;
   private var _picking:Stage = null;
   private var _exact:uint = 0;
   private var _true:Boolean = false;
   private var _tick:Shape;
   public static var trueByDefault:Boolean = false;

   public function JRColorPicker(param1:uint, param2:Function, param3:Function, param4:Boolean = false)
   {
      super();
      _snap = param2;
      _done = param3;
      _true = param4;
      var _loc4_:Graphics = graphics;
      _loc4_.lineStyle(4,0x7A4A22,1,true);
      _loc4_.beginFill(0xE8D8B4,1);
      _loc4_.drawRoundRect(0,0,W,H,20,20);
      _loc4_.endFill();
      _loc4_.lineStyle(0,0,0);
      _loc4_.beginFill(0xFFEAA8,1);
      _loc4_.drawRoundRect(2,2,W - 4,30,18,18);
      _loc4_.drawRect(2,16,W - 4,16);
      _loc4_.endFill();
      _loc4_.lineStyle(2,0xD9BF8C,1);
      _loc4_.moveTo(2,32);
      _loc4_.lineTo(W - 2,32);
      filters = [new DropShadowFilter(4,90,0,0.45,12,12,1,2)];
      var _loc5_:TextField = JRStyle.field("Pick a Color",17,JRStyle.WOOD_DARK,true);
      _loc5_.x = Math.round((W - _loc5_.width) / 2);
      _loc5_.y = Math.round((33 - _loc5_.height) / 2);
      addChild(_loc5_);
      var _loc6_:JRMiniBtn = new JRMiniBtn("x",30,30,"normal",onCancel);
      _loc6_.x = W - 24;
      _loc6_.y = -8;
      addChild(_loc6_);
      // the color square
      _svArea = new Sprite();
      _svArea.x = 16;
      _svArea.y = 46;
      _sv = new Shape();
      _svArea.addChild(_sv);
      _mark = new Shape();
      _mark.graphics.lineStyle(3,0x333333,1);
      _mark.graphics.drawCircle(0,0,5);
      _mark.graphics.lineStyle(1.5,0xFFFFFF,1);
      _mark.graphics.drawCircle(0,0,5);
      _svArea.addChild(_mark);
      _svArea.buttonMode = true;
      _svArea.addEventListener(MouseEvent.MOUSE_DOWN,onSvDown);
      addChild(_svArea);
      box(_loc4_,16,46,160,160,-1);
      // the rainbow strip
      _hueArea = new Sprite();
      _hueArea.x = 186;
      _hueArea.y = 46;
      var _loc7_:Matrix = new Matrix();
      _loc7_.createGradientBox(20,160,Math.PI / 2,0,0);
      _hueArea.graphics.beginGradientFill(GradientType.LINEAR,[0xFF0000,0xFFFF00,0x00FF00,0x00FFFF,0x0000FF,0xFF00FF,0xFF0000],[1,1,1,1,1,1,1],[0,42,85,128,170,213,255],_loc7_);
      _hueArea.graphics.drawRect(0,0,20,160);
      _hueArea.graphics.endFill();
      _handle = new Shape();
      _handle.graphics.lineStyle(1,0x333333,1);
      _handle.graphics.beginFill(0xFFFFFF,1);
      _handle.graphics.drawRect(-3,-3,25,6);
      _handle.graphics.endFill();
      _handle.graphics.lineStyle(0,0,0);
      _handle.graphics.beginFill(0x45A82A,1);
      _handle.graphics.drawRect(-1,-1,21,2);
      _handle.graphics.endFill();
      _hueArea.addChild(_handle);
      _hueArea.buttonMode = true;
      _hueArea.addEventListener(MouseEvent.MOUSE_DOWN,onHueDown);
      addChild(_hueArea);
      box(_loc4_,186,46,20,160,-1);
      // New and Before
      var _loc8_:TextField = JRStyle.field("New",13,JRStyle.TEXT);
      _loc8_.x = 216;
      _loc8_.y = 40;
      addChild(_loc8_);
      _newBox = new Shape();
      addChild(_newBox);
      var _loc9_:TextField = JRStyle.field("Before",13,JRStyle.TEXT);
      _loc9_.x = 216;
      _loc9_.y = 92;
      addChild(_loc9_);
      box(_loc4_,214,110,126,30,param1);
      // the color code
      _loc4_.lineStyle(1,BORDER,1,true);
      _loc4_.beginFill(0xFFFFFF,1);
      _loc4_.drawRect(214,148,126,20);
      _loc4_.endFill();
      _hex = new TextField();
      _hex.defaultTextFormat = new TextFormat("Verdana",12,JRStyle.TEXT);
      _hex.type = TextFieldType.INPUT;
      _hex.maxChars = 7;
      _hex.restrict = "#0-9a-fA-F";
      _hex.x = 217;
      _hex.y = 149;
      _hex.width = 120;
      _hex.height = 19;
      _hex.addEventListener(KeyboardEvent.KEY_DOWN,onKey);
      _hex.addEventListener(KeyboardEvent.KEY_UP,swallow);
      addChild(_hex);
      _pick = new JRTextBtn("Pick","dropper",true,80,24,"normal",onPick);
      _pick.x = 237;
      _pick.y = 176;
      addChild(_pick);
      // True color: your animal in the exact color, on your screen only.
      var _loc12_:Sprite = new Sprite();
      _loc12_.x = 16;
      _loc12_.y = 216;
      _loc12_.graphics.lineStyle(2,BORDER,1,true);
      _loc12_.graphics.beginFill(0xFFFFFF,1);
      _loc12_.graphics.drawRoundRect(0,0,18,18,5,5);
      _loc12_.graphics.endFill();
      _tick = new Shape();
      JRIcon.draw(_tick.graphics,"check",9,9,7);
      _tick.filters = [new GlowFilter(0x245E12,1,3,3,6,2)];
      _loc12_.addChild(_tick);
      var _loc13_:TextField = JRStyle.field("True color",13,JRStyle.TEXT,true);
      _loc13_.x = 24;
      _loc13_.y = -1;
      _loc12_.addChild(_loc13_);
      var _loc14_:TextField = JRStyle.field("Exact color, only you see it.\nOthers see the New game color.",10,JRStyle.DIM);
      _loc14_.x = 0;
      _loc14_.y = 20;
      _loc12_.addChild(_loc14_);
      _loc12_.buttonMode = true;
      _loc12_.mouseChildren = false;
      _loc12_.addEventListener(MouseEvent.MOUSE_DOWN,onTrue);
      addChild(_loc12_);
      _tick.visible = _true;
      var _loc10_:JRTextBtn = new JRTextBtn("Cancel","x",false,78,26,"danger",onCancel);
      _loc10_.x = 176;
      _loc10_.y = 244;
      addChild(_loc10_);
      var _loc11_:JRTextBtn = new JRTextBtn("Set","check",false,78,26,"primary",onSet);
      _loc11_.x = 262;
      _loc11_.y = 244;
      addChild(_loc11_);
      addEventListener(MouseEvent.MOUSE_DOWN,swallow);
      addEventListener(Event.REMOVED_FROM_STAGE,onGone);
      setRgb(param1);
   }

   // The color of the screen under the mouse, or -1 when it can't be read.
   public static function sample(param1:Stage) : int
   {
      var _loc2_:BitmapData = new BitmapData(1,1,false,0);
      var _loc3_:int = -1;
      try
      {
         _loc2_.draw(param1,new Matrix(1,0,0,1,-param1.mouseX,-param1.mouseY));
         _loc3_ = int(_loc2_.getPixel(0,0));
      }
      catch(e:Error)
      {
         _loc3_ = -1;
      }
      _loc2_.dispose();
      return _loc3_;
   }

   private function box(param1:Graphics, param2:Number, param3:Number, param4:Number, param5:Number, param6:int) : void
   {
      param1.lineStyle(3,BORDER,1,true);
      if(param6 >= 0)
      {
         param1.beginFill(param6,1);
      }
      param1.drawRect(param2,param3,param4,param5);
      if(param6 >= 0)
      {
         param1.endFill();
      }
   }

   private static function hsv(param1:Number, param2:Number, param3:Number) : uint
   {
      var _loc4_:Number = (param1 % 360) / 60;
      var _loc5_:int = Math.floor(_loc4_);
      var _loc6_:Number = _loc4_ - _loc5_;
      var _loc7_:Number = param3 * (1 - param2);
      var _loc8_:Number = param3 * (1 - param2 * _loc6_);
      var _loc9_:Number = param3 * (1 - param2 * (1 - _loc6_));
      var _loc10_:Array = [[param3,_loc9_,_loc7_],[_loc8_,param3,_loc7_],[_loc7_,param3,_loc9_],[_loc7_,_loc8_,param3],[_loc9_,_loc7_,param3],[param3,_loc7_,_loc8_]][_loc5_ % 6];
      return uint(Math.round(_loc10_[0] * 255)) << 16 | uint(Math.round(_loc10_[1] * 255)) << 8 | uint(Math.round(_loc10_[2] * 255));
   }

   private function setRgb(param1:uint) : void
   {
      var _loc2_:Number = (param1 >> 16 & 0xFF) / 255;
      var _loc3_:Number = (param1 >> 8 & 0xFF) / 255;
      var _loc4_:Number = (param1 & 0xFF) / 255;
      var _loc5_:Number = Math.max(_loc2_,_loc3_,_loc4_);
      var _loc6_:Number = _loc5_ - Math.min(_loc2_,_loc3_,_loc4_);
      var _loc7_:Number = 0;
      if(_loc6_ > 0)
      {
         if(_loc5_ == _loc2_)
         {
            _loc7_ = 60 * (((_loc3_ - _loc4_) / _loc6_ + 6) % 6);
         }
         else if(_loc5_ == _loc3_)
         {
            _loc7_ = 60 * ((_loc4_ - _loc2_) / _loc6_ + 2);
         }
         else
         {
            _loc7_ = 60 * ((_loc2_ - _loc3_) / _loc6_ + 4);
         }
         _hue = _loc7_;
      }
      _sat = _loc5_ > 0 ? _loc6_ / _loc5_ : 0;
      _val = _loc5_;
      redraw(true);
   }

   private function redraw(param1:Boolean) : void
   {
      var _loc2_:Matrix = new Matrix();
      var _loc3_:Graphics = null;
      if(param1)
      {
         _loc3_ = _sv.graphics;
         _loc3_.clear();
         _loc3_.beginFill(hsv(_hue,1,1),1);
         _loc3_.drawRect(0,0,160,160);
         _loc3_.endFill();
         _loc2_.createGradientBox(160,160,0,0,0);
         _loc3_.beginGradientFill(GradientType.LINEAR,[0xFFFFFF,0xFFFFFF],[1,0],[0,255],_loc2_);
         _loc3_.drawRect(0,0,160,160);
         _loc3_.endFill();
         _loc2_.createGradientBox(160,160,Math.PI / 2,0,0);
         _loc3_.beginGradientFill(GradientType.LINEAR,[0,0],[0,1],[0,255],_loc2_);
         _loc3_.drawRect(0,0,160,160);
         _loc3_.endFill();
      }
      _mark.x = Math.round(_sat * 159);
      _mark.y = Math.round((1 - _val) * 159);
      _handle.y = Math.round(_hue / 360 * 159);
      _exact = hsv(_hue,_sat,_val);
      _result = uint(_snap(_exact));
      var _loc5_:uint = _true ? _exact : _result;
      _newBox.graphics.clear();
      box(_newBox.graphics,214,58,126,30,_loc5_);
      if(_true && _exact != _result)
      {
         // the game color others see, in the corner of New
         _newBox.graphics.lineStyle(2,BORDER,1,true);
         _newBox.graphics.beginFill(_result,1);
         _newBox.graphics.drawRect(318,72,20,14);
         _newBox.graphics.endFill();
      }
      if(stage == null || stage.focus != _hex)
      {
         var _loc4_:String = _loc5_.toString(16).toUpperCase();
         while(_loc4_.length < 6)
         {
            _loc4_ = "0" + _loc4_;
         }
         _hex.textColor = JRStyle.TEXT;
         _hex.text = "#" + _loc4_;
      }
   }

   private function onSvDown(param1:MouseEvent) : void
   {
      param1.stopPropagation();
      startDrag2("sv");
   }

   private function onHueDown(param1:MouseEvent) : void
   {
      param1.stopPropagation();
      startDrag2("hue");
   }

   private function startDrag2(param1:String) : void
   {
      _drag = param1;
      if(stage)
      {
         stage.addEventListener(MouseEvent.MOUSE_MOVE,onMove);
         stage.addEventListener(MouseEvent.MOUSE_UP,onUp);
      }
      onMove(null);
   }

   private function onMove(param1:MouseEvent) : void
   {
      if(_drag == "sv")
      {
         _sat = Math.max(0,Math.min(1,_svArea.mouseX / 159));
         _val = 1 - Math.max(0,Math.min(1,_svArea.mouseY / 159));
         redraw(false);
      }
      else if(_drag == "hue")
      {
         _hue = Math.max(0,Math.min(359.9,_hueArea.mouseY / 159 * 360));
         redraw(true);
      }
   }

   private function onUp(param1:MouseEvent) : void
   {
      _drag = null;
      if(stage)
      {
         stage.removeEventListener(MouseEvent.MOUSE_MOVE,onMove);
         stage.removeEventListener(MouseEvent.MOUSE_UP,onUp);
      }
   }

   // Pick: the next click anywhere takes that color.
   private function onPick() : void
   {
      if(_picking)
      {
         stopPicking();
         return;
      }
      if(stage == null)
      {
         return;
      }
      _picking = stage;
      _picking.addEventListener(MouseEvent.MOUSE_DOWN,onPickDown,true,100);
      _pick.lit = true;
   }

   private function onPickDown(param1:MouseEvent) : void
   {
      param1.stopImmediatePropagation();
      var _loc2_:Stage = _picking;
      stopPicking();
      if(_pick.contains(param1.target as DisplayObject))
      {
         return;
      }
      var _loc3_:int = sample(_loc2_);
      if(_loc3_ >= 0)
      {
         setRgb(uint(_loc3_));
      }
   }

   private function stopPicking() : void
   {
      if(_picking)
      {
         _picking.removeEventListener(MouseEvent.MOUSE_DOWN,onPickDown,true);
         _picking = null;
      }
      _pick.lit = false;
   }

   private function onKey(param1:KeyboardEvent) : void
   {
      param1.stopPropagation();
      if(param1.keyCode == 13)
      {
         var _loc2_:String = _hex.text.replace(/#/g,"");
         if(_loc2_.length == 3)
         {
            _loc2_ = _loc2_.charAt(0) + _loc2_.charAt(0) + _loc2_.charAt(1) + _loc2_.charAt(1) + _loc2_.charAt(2) + _loc2_.charAt(2);
         }
         if(!/^[0-9a-fA-F]{6}$/.test(_loc2_))
         {
            _hex.textColor = JRStyle.BAD;
            return;
         }
         if(stage)
         {
            stage.focus = null;
         }
         setRgb(uint(parseInt(_loc2_,16)));
      }
      else if(param1.keyCode == 27)
      {
         onCancel();
      }
   }

   private function swallow(param1:Event) : void
   {
      param1.stopPropagation();
   }

   private function onTrue(param1:MouseEvent) : void
   {
      param1.stopPropagation();
      _true = !_true;
      trueByDefault = _true;
      _tick.visible = _true;
      redraw(false);
   }

   private function onSet() : void
   {
      var _loc1_:Function = _done;
      var _loc2_:uint = _result;
      var _loc3_:uint = _exact;
      var _loc4_:Boolean = _true;
      close();
      _loc1_(_loc2_,_loc3_,_loc4_);
   }

   private function onCancel() : void
   {
      close();
   }

   private function onGone(param1:Event) : void
   {
      onUp(null);
      stopPicking();
   }

   public function close() : void
   {
      onUp(null);
      stopPicking();
      if(stage)
      {
         stage.focus = null;
      }
      if(parent)
      {
         parent.removeChild(this);
      }
   }
}

// ------------------------------------------------------------ item pictures
// An item's picture, the way the game shows it in your inventory: the
// game's own Item (clothing, in a color) or DenItem (in a version) draws it.
// ic: {k: "c" | "d", id, c: color, v: version}.

class JRItemIcon extends Sprite
{
   public var versions:int = 0;

   private var _size:Number;

   private var _item:Object;

   private var _started:int;

   private var _done:Function;

   private static const TIMEOUT:int = 20000;

   public function JRItemIcon(param1:Object, param2:Number, param3:Boolean = true, param4:Function = null)
   {
      super();
      _size = param2;
      _done = param4;
      mouseEnabled = false;
      mouseChildren = false;
      if(param3)
      {
         graphics.lineStyle(1,JRStyle.PARCH_LINE,1,true);
         graphics.beginFill(0xFFFFFF,0.85);
         graphics.drawRoundRect(0,0,_size,_size,10,10);
         graphics.endFill();
      }
      try
      {
         if(String(param1.k) == "d")
         {
            // Mannequins can't be drawn without their look: give them the default one.
            var _loc7_:MannequinData = null;
            var _loc8_:DenItemDef = DenXtCommManager.getDenItemDef(int(param1.id));
            if(_loc8_ != null && int(_loc8_.specialType) == 4)
            {
               _loc7_ = new MannequinData();
               _loc7_.init(_loc8_,null,0,true,0,false);
            }
            var _loc5_:DenItem = new DenItem();
            _loc5_.init(int(param1.id),0,0,int(param1.v),0,null,true,"","",-1,"",_loc7_,0,0);
            _loc5_.makeSmallIcon();
            _item = _loc5_;
         }
         else
         {
            var _loc6_:Item = new Item();
            _loc6_.init(int(param1.id),0,uint(param1.c));
            _loc6_.makeSmallIcon();
            _item = _loc6_;
         }
      }
      catch(e:Error)
      {
         _item = null;
      }
      _started = getTimer();
      addEventListener(Event.ENTER_FRAME,onFrame);
   }

   private function onFrame(param1:Event) : void
   {
      var _loc2_:Boolean = false;
      try
      {
         _loc2_ = _item != null && Boolean(_item.isIconLoaded);
      }
      catch(e:Error)
      {
      }
      if(!_loc2_ && _item != null && getTimer() - _started < TIMEOUT)
      {
         return;
      }
      removeEventListener(Event.ENTER_FRAME,onFrame);
      if(_loc2_)
      {
         show();
      }
      if(_done != null)
      {
         _done(this,_loc2_);
      }
   }

   private function show() : void
   {
      var _loc1_:Sprite = null;
      try
      {
         _loc1_ = _item.icon as Sprite;
         if(_item is DenItem)
         {
            var _loc2_:Array = DenItem(_item).getVersions();
            versions = _loc2_ != null ? _loc2_.length : 0;
         }
      }
      catch(e:Error)
      {
         return;
      }
      if(_loc1_ == null)
      {
         return;
      }
      var _loc3_:Sprite = new Sprite();
      _loc3_.addChild(_loc1_);
      addChild(_loc3_);
      var _loc4_:Rectangle = _loc3_.getBounds(_loc3_);
      if(_loc4_.width <= 0 || _loc4_.height <= 0)
      {
         return;
      }
      var _loc5_:Number = Math.min((_size - 6) / _loc4_.width,(_size - 6) / _loc4_.height,_size > 60 ? 3 : 1.5);
      _loc3_.scaleX = _loc3_.scaleY = _loc5_;
      _loc3_.x = Math.round((_size - _loc4_.width * _loc5_) / 2 - _loc4_.x * _loc5_);
      _loc3_.y = Math.round((_size - _loc4_.height * _loc5_) / 2 - _loc4_.y * _loc5_);
   }

   /** The picture as a PNG (transparent background), or null. */
   public function png() : ByteArray
   {
      try
      {
         var _loc1_:BitmapData = new BitmapData(Math.ceil(_size),Math.ceil(_size),true,0);
         _loc1_.draw(this,null,null,null,null,true);
         return JRPng.encode(_loc1_);
      }
      catch(e:Error)
      {
      }
      return null;
   }
}

// Draws pictures JR asks for ("i") and sends each back as a PNG:
//   jr  i  <key>  <PNG, base64 or ->  <den item versions>
// A few at a time, so the game stays smooth.

class JRPictureMaker
{
   private static var _queue:Array = [];

   private static var _busy:int = 0;

   private static const AT_ONCE:int = 3;

   private static const SIZE:int = 96;

   public static function ask(param1:Array) : void
   {
      var _loc2_:Object = null;
      for each(_loc2_ in param1)
      {
         if(_loc2_ && _loc2_.key)
         {
            _queue.push(_loc2_);
         }
      }
      next();
   }

   private static function next() : void
   {
      var _loc1_:Object = null;
      while(_busy < AT_ONCE && _queue.length > 0)
      {
         _loc1_ = _queue.shift();
         _busy++;
         makeOne(_loc1_);
      }
   }

   private static function makeOne(param1:Object) : void
   {
      var key:String = String(param1.key);
      new JRItemIcon(param1,SIZE,false,function(param2:JRItemIcon, param3:Boolean):void
      {
         var _loc4_:String = "-";
         if(param3)
         {
            var _loc5_:ByteArray = param2.png();
            if(_loc5_ != null)
            {
               _loc4_ = JRPng.base64(_loc5_);
            }
         }
         XtReplyDemuxer.jrSend(["i",key,_loc4_,String(param2.versions)]);
         _busy--;
         next();
      });
   }
}

// A small PNG writer: 32-bit RGBA, no filtering, zlib from ByteArray.compress().

class JRPng
{
   private static var _crc:Array;

   public static function encode(param1:BitmapData) : ByteArray
   {
      var _loc2_:ByteArray = new ByteArray();
      _loc2_.writeUnsignedInt(0x89504E47);
      _loc2_.writeUnsignedInt(0x0D0A1A0A);
      var _loc3_:ByteArray = new ByteArray();
      _loc3_.writeInt(param1.width);
      _loc3_.writeInt(param1.height);
      _loc3_.writeByte(8);
      _loc3_.writeByte(6);
      _loc3_.writeByte(0);
      _loc3_.writeByte(0);
      _loc3_.writeByte(0);
      chunk(_loc2_,0x49484452,_loc3_);
      var _loc4_:ByteArray = new ByteArray();
      var _loc5_:int = 0;
      var _loc6_:int = 0;
      var _loc7_:uint = 0;
      _loc5_ = 0;
      while(_loc5_ < param1.height)
      {
         _loc4_.writeByte(0);
         _loc6_ = 0;
         while(_loc6_ < param1.width)
         {
            _loc7_ = param1.getPixel32(_loc6_,_loc5_);
            _loc4_.writeUnsignedInt(uint((_loc7_ & 0xFFFFFF) << 8 | _loc7_ >>> 24));
            _loc6_++;
         }
         _loc5_++;
      }
      _loc4_.compress();
      chunk(_loc2_,0x49444154,_loc4_);
      chunk(_loc2_,0x49454E44,null);
      return _loc2_;
   }

   private static function chunk(param1:ByteArray, param2:uint, param3:ByteArray) : void
   {
      var _loc4_:uint = param3 != null ? param3.length : 0;
      param1.writeUnsignedInt(_loc4_);
      var _loc5_:uint = param1.position;
      param1.writeUnsignedInt(param2);
      if(param3 != null)
      {
         param1.writeBytes(param3);
      }
      var _loc6_:uint = param1.position;
      param1.position = _loc5_;
      var _loc7_:uint = 0xFFFFFFFF;
      var _loc8_:int = 0;
      if(_crc == null)
      {
         makeTable();
      }
      _loc8_ = 0;
      while(_loc8_ < int(_loc6_ - _loc5_))
      {
         _loc7_ = uint(_crc[(_loc7_ ^ param1.readUnsignedByte()) & 0xFF]) ^ (_loc7_ >>> 8);
         _loc8_++;
      }
      param1.position = _loc6_;
      param1.writeUnsignedInt(_loc7_ ^ 0xFFFFFFFF);
   }

   private static function makeTable() : void
   {
      var _loc1_:uint = 0;
      var _loc2_:int = 0;
      var _loc3_:int = 0;
      _crc = [];
      _loc2_ = 0;
      while(_loc2_ < 256)
      {
         _loc1_ = uint(_loc2_);
         _loc3_ = 0;
         while(_loc3_ < 8)
         {
            if(_loc1_ & 1)
            {
               _loc1_ = 0xEDB88320 ^ (_loc1_ >>> 1);
            }
            else
            {
               _loc1_ = _loc1_ >>> 1;
            }
            _loc3_++;
         }
         _crc[_loc2_] = _loc1_;
         _loc2_++;
      }
   }

   private static const B64:String = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

   public static function base64(param1:ByteArray) : String
   {
      var _loc2_:Array = [];
      var _loc3_:int = 0;
      var _loc4_:uint = 0;
      var _loc5_:int = param1.length;
      param1.position = 0;
      _loc3_ = 0;
      while(_loc3_ < _loc5_)
      {
         _loc4_ = param1[_loc3_] << 16 | (_loc3_ + 1 < _loc5_ ? param1[_loc3_ + 1] << 8 : 0) | (_loc3_ + 2 < _loc5_ ? param1[_loc3_ + 2] : 0);
         _loc2_.push(B64.charAt(_loc4_ >>> 18 & 63),B64.charAt(_loc4_ >>> 12 & 63),_loc3_ + 1 < _loc5_ ? B64.charAt(_loc4_ >>> 6 & 63) : "=",_loc3_ + 2 < _loc5_ ? B64.charAt(_loc4_ & 63) : "=");
         _loc3_ += 3;
      }
      return _loc2_.join("");
   }
}


// ------------------------------------------------------------ den previews
// JR's Den Item Previewer ("dp"): puts a preview den item in your den
// inventory (the editor's bottom bar) and, when asked, in your den - the
// same way the editor places an item you click (DenEditor.placeItemInRoom),
// so nothing else in your den moves. Nothing is sent to Animal Jam.
//   {op: "add", s: slot, d: item id, v: version, place: true}
//   {op: "remove", s: slot}

class JRDenPreview
{
   public static function apply(param1:Object) : void
   {
      try
      {
         var _loc2_:DenItemCollection = gMainFrame.userInfo.playerUserInfo.denItemsFull;
         if(_loc2_ == null)
         {
            return;
         }
         var _loc3_:int = int(param1.s);
         var _loc4_:RoomManagerWorld = RoomManagerWorld.instance;
         var _loc5_:int = 0;
         // Never twice: take out any copy first (from the bar and the den).
         _loc5_ = _loc2_.length - 1;
         while(_loc5_ >= 0)
         {
            if(_loc2_.getDenItem(_loc5_).invIdx == _loc3_)
            {
               _loc2_.getCoreArray().splice(_loc5_,1);
            }
            _loc5_--;
         }
         if(_loc4_ && _loc4_.denItemHolder)
         {
            _loc4_.denItemHolder.removeItem(_loc3_,0);
         }
         if(String(param1.op) == "add")
         {
            var _loc6_:DenItemDef = DenXtCommManager.getDenItemDef(int(param1.d));
            if(_loc6_ == null)
            {
               return;
            }
            var _loc7_:MannequinData = null;
            if(int(_loc6_.specialType) == 4)
            {
               _loc7_ = new MannequinData();
               _loc7_.init(_loc6_,null,0,true,_loc3_,true);
            }
            var _loc8_:DenItem = new DenItem();
            _loc8_.init(int(param1.d),_loc3_,0,int(param1.v),0,null,true,"","",-1,"",_loc7_,0,0);
            _loc2_.pushDenItem(_loc8_);
            if(param1.place && _loc4_ && _loc4_.isMyDen && _loc4_.denItemHolder)
            {
               var _loc9_:int = DenItem.getInWorldId(_loc8_.sortId,_loc4_.denCatId);
               _loc8_.categoryId = _loc9_;
               _loc4_.spawnNewDenItem(new DenStateItem(_loc8_.defId,_loc8_.invIdx,_loc8_.defId << 16 | _loc9_,0,0,_loc8_.version,_loc8_.version2,_loc8_.version3,0,_loc9_,_loc8_.refId,_loc8_.sortId,_loc8_.minigameDefId,_loc8_.layerId,_loc8_.enviroType,_loc8_.strmName,0,"",_loc8_.specialType,_loc8_.listId,_loc8_.uniqueImageId,_loc8_.uniqueImageCreator,_loc8_.uniqueImageCreatorDbId,_loc8_.uniqueImageCreatorUUID,false,null,0,0,_loc8_.petItem,_loc8_.mannequinData,_loc8_.ecoConsumerStateId));
            }
         }
         // The same bookkeeping as the editor after a change, then redraw its bar.
         gMainFrame.userInfo.playerUserInfo.denItemsPartial = DenXtCommManager.enviroItems(_loc2_);
         if(AvatarManager.playerAvatar != null)
         {
            AvatarManager.playerAvatar.inventoryDenPartial.denItemCollection = gMainFrame.userInfo.playerUserInfo.denItemsPartial;
            AvatarManager.playerAvatar.inventoryDenFull.denItemCollection = _loc2_;
         }
         gMainFrame.userInfo.playerUserInfo.denItemsFull = _loc2_;
         if(GuiManager.denEditor)
         {
            GuiManager.denEditor.reloadDenItems();
         }
      }
      catch(e:Error)
      {
      }
   }
}
