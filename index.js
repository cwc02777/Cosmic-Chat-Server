const express = require('express');
const app = express();
const fs = require('fs');
const BanUUID = JSON.parse(fs.readFileSync("./Ban/UUID.json"));
const http = require('http');
const server = http.Server(app);
const sockets = require('socket.io');
io = sockets(server);
const Redis = require('ioredis');
const Discord = require('discord.js');
const client = new Discord.Client();

const { RateLimiterMemory } = require('rate-limiter-flexible');

var webhookChannelId = "832853964819136532";
var webhookToken = process.env['WebHookToken'];
var msgChannelId = "831494456913428501";
const log = new Discord.WebhookClient(webhookChannelId, webhookToken);
const Swearing = fs.readFileSync("./Ban/not_message.txt").toString().split("\n");

const { FormattingCodeToMD } = require("./Function/FormattingCodeConverter");
const { MojangAuth } = require("./Function/MojangAuth");
const { MSAuth } = require("./Function/MSAuth");
const { HashUtil } = require("./Function/HashUtil");
const utils = new HashUtil();
let onlineCount = 0;
let isReady = false;

var TooManyRequests = {};
var userList = {};

app.get('/', function(req, res) {
  res.json({
    code:200,
    message:"Hello RPMTW World"
  });
});

require("./discord/init")(client, log)

const rateLimiter = new RateLimiterMemory(
  {
    points: 5,
    duration: 1,
  });
  
client.on('ready', () => {
  isReady = true;
})

client.on("message", async (msg) => {
  if (msg.author.bot) return;
  if (msg.channel.id === msgChannelId) {
    if (Swearing.includes(msg.content)) {
      // 防髒話系統
      return msg.delete()
    }
    let MDMsg = await FormattingCodeToMD(msg.content);
  
    if (msg.reference) {
      //如果該訊息是回覆的訊息
      msg.channel.messages.fetch(msg.reference.messageID).then(message => {
        let tag = message.author.tag;
        if (tag === msg.author.tag) {
          tag = "自己"
        }
        if (tag === "菘菘#8663" || tag === "SiongSng") {
          tag = "§bRPMTW維護者";
        }
        let MDMessage = FormattingCodeToMD(message.content);
      
        let data = { "Type": "Client", "MessageType": "General", "Message": `§a回覆 §6${tag} §b${MDMessage} §a-> §f${MDMsg}`, "UserName": msg.author.tag }
        io.emit("broadcast", data);
      })
        .catch(console.error);
    } else {
      let data = { "Type": "Client", "MessageType": "General", "Message": MDMsg, "UserName": msg.author.tag }
      io.emit("broadcast", data);
    }
  }
});

io.on('connection', async function(socket) {

  const Token = socket.handshake.auth.Token;
  const UUID = socket.handshake.auth.UUID;
  const chkSum =socket.handshake.auth.CS;

  if (Token == undefined || UUID == undefined) return socket.disconnect();

  console.log(`{ \n\tToken = ${Token}\n\tUUID = ${UUID}\n\tchkSum = ${chkSum}\n}`)
  if(chkSum !== utils.GetHashString(Token+UUID)){
    console.log("驗證失敗 拒絕連線");
    return socket.disconnect();
  }
  console.log("驗證成功");
   try {
  await rateLimiter.consume(UUID);
  }catch(rejRes) {
   console.log("連線宇宙通訊伺服器超速");
   return socket.disconnect();
 }

  const isAuth = await MojangAuth(Token) == true ? true : await MSAuth(Token);
  onlineCount++; //增加連線數
  console.log(`目前連線數: ${onlineCount}`);
  if (isReady) {
    client.user.setActivity(`宇宙通訊共有 ${onlineCount} 個玩家`, { type: 'WATCHING' })
      .catch(console.error);
  }

  try {
    socket.on('message', function(data) {
      console.log('new data: ' + data);
      log.send(`\`\`\`json\n${data}\`\`\``); //發送訊息到Discord後台
      try {
        // 如果該使用者不是正版帳號
        if (!isAuth) {
          data = {
            'Type': "Server",
            'MessageType': 'Auth',
            'UUID': UUID
          }
          io.emit("broadcast", data);
        }

        // 如果該UUID已經被Ban
        if (BanUUID.includes(UUID)) {
          data = {
            'Type': "Server",
            'MessageType': 'Ban',
            'UUID': UUID
          }
          return io.emit("broadcast", data);
        };

        let JsonData = JSON.parse(data);
        let Message = JsonData.Message;
        let UserName = JsonData.UserName;
        let MessageType = JsonData.MessageType;

        // 如果訊息無效則跳過處理
        if (Message == null) return;
        if (Message == "@everyone") return;

        // 防髒話
        if (Swearing.includes(Message)) return log.send(`偵測到髒話，訊息內容 ${Message}，UUID ${UUID}， UserName ${UserName}`);
        // 防刷訊息
        if (TooManyRequests.hasOwnProperty(UUID)) {
          let t = TooManyRequests[UUID];
          if ((new Date() - t["time"]) <= 2000) {
            console.log("test2");
            // 相差是否大於2秒
            if (t["ViolationCount"] > 1) {
              log.send(`偵測到發送訊息過快，訊息內容 ${Message}，UUID ${UUID}， UserName ${UserName}`);
              BanUUID.push(UUID); //將UUID加入BanUUID
              fs.writeFile('./Ban/UUID.json', JSON.stringify(BanUUID, null, 4), error => {
                if (error) console.log(error);
              });
            }
          }
          t["time"] = new Date();
        } else {
          TooManyRequests[UUID] = { "time": new Date(), "ViolationCount": 0 };
        }

        if (MessageType == "General") {
          require("./discord/SendMessage")(msgChannelId, client, Message, UUID, UserName); //發送訊息到Discord宇宙通訊頻道
          data = { "Type": "Client", "MessageType": "General", "Message": FormattingCodeToMD(Message), "UserName": UserName };
          io.emit("broadcast", data); //推播訊息給遊戲客戶端
        }
      } catch (err) {
        console.log(err);
      }
    });
    socket.on('disconnect', () => {
      onlineCount = (onlineCount < 0) ? 0 : onlineCount -= 1; //減少連線數
      console.log(`目前連線數: ${onlineCount}`);
    });
  } catch (err) {
    console.log(err);
  }
});

server.listen(3000, function() {
  console.log('listening on 3000');
});