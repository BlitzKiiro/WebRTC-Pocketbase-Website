import "./globals.css";
import PocketBase from "pocketbase";

//DOM query selectors
let video1 = document.querySelector("#user-1");
let video2 = document.querySelector("#user-2");
let createInput = document.querySelector("#create-input");
let joinInput = document.querySelector("#join-input");
let createBtn = document.querySelector("#create-btn");
let joinBtn = document.querySelector("#join-btn");
let shareBtn = document.querySelector("#share-screen");
let fullScreenBtn = document.querySelector("#full-screen");
let muteBtn = document.querySelector("#mute-mic");
let unmMuteBtn = document.querySelector("#unmute-mic");

//pocketbase configration
const pb = new PocketBase("https://appetizing-potato.pockethost.io");

//stun servers
const config = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
    },
  ],
};

// conntection and streams vars
let localStream = null; //local media stream
let remoteStream = null; //incoming media stream
let peerConnection = new RTCPeerConnection(config); //RTC peer connection object

//setting up local & remote media sources
localStream = await navigator.mediaDevices.getUserMedia({
  video: true,
  audio: true,
});
remoteStream = new MediaStream();

//adding localStream to the Peer Connection Obj
let camVideoTrack = localStream.getVideoTracks()[0];
let camAudioTrack = localStream.getAudioTracks()[0];
let videoSender = peerConnection.addTrack(camVideoTrack, localStream);
let audioSender = peerConnection.addTrack(camAudioTrack, localStream);

//getting incoming media stream tracks from peer connection and adding it to remote stream
peerConnection.ontrack = (event) => {
  event.streams[0].getTracks().forEach((track) => {
    remoteStream.addTrack(track);
  });
};

video1.srcObject = new MediaStream(localStream.getVideoTracks());
video2.srcObject = remoteStream;

//creating call function
async function createOffer() {
  //creating pocketbase call document and setting id
  let callDOC = await pb.collection("calls").create();
  const callID = callDOC.id;
  createInput.value = callID;

  //listen to ice candidates created PC and stun servers
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      pb.collection("offer_candidates")
        .create(
          {
            callID,
            rTCIceCandidate: event.candidate,
          },
          { $autoCancel: false }
        )
        .then(({ id }) => {
          console.log("offer canidate created", { id });
        });
    }
  };

  // creating RTC peer connection offer and setting it as our local RTC session description
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  callDOC = await pb.collection("calls").update(callID, { offer });
  console.log("created and uploaded offer sdp", offer);
  //listen to remote answers
  pb.collection("calls").subscribe(callID, async function (e) {
    const data = e.record;
    if (!peerConnection.currentRemoteDescription && data?.answer) {
      const remoteDescription = new RTCSessionDescription(data.answer);
      await peerConnection.setRemoteDescription(remoteDescription);
      console.log("remote description was set", remoteDescription);
      // get answer canidates from DB and assigning them to PeerConnection
      const answerCandidates = await pb
        .collection("answer_candidates")
        .getFullList(100, {
          filter: `callID = "${callID}"`,
        });
      answerCandidates.forEach((candidate) => {
        const data = candidate.rTCIceCandidate;
        const iceCandidate = new RTCIceCandidate(data);
        peerConnection.addIceCandidate(iceCandidate);
        console.log("answer canidate added", iceCandidate);
      });
    }
  });
}

//joining call functions
async function answerOffer() {
  //getting offer call document
  const callID = joinInput.value;
  let callDoc = await pb.collection("calls").getOne(callID);

  //adding our answering end ice candidates to the server
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      pb.collection("answer_candidates")
        .create(
          {
            callID,
            rTCIceCandidate: event.candidate,
          },
          { $autoCancel: false }
        )
        .then(({ id }) => {
          console.log("answer canidate created", { id });
        });
    }
  };
  //getting offer doc SDP (session description) and adding it to the peer connection
  const remoteOfferDescription = new RTCSessionDescription(callDoc.offer);
  await peerConnection.setRemoteDescription(remoteOfferDescription);
  console.log("remoted description was set", remoteOfferDescription);
  // creating our answer SDP and adding it to the server and peer connection
  const answerDescription = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answerDescription);
  await pb.collection("calls").update(callID, { answer: answerDescription });
  console.log("answer sdp created");

  // get offer canidates from DB and assigning them to PeerConnection
  const offerCandidates = await pb
    .collection("offer_candidates")
    .getFullList(100, {
      filter: `callID = "${callID}"`,
    });
  offerCandidates.forEach((candidate) => {
    const data = candidate.rTCIceCandidate;
    const iceCandidate = new RTCIceCandidate(data);
    peerConnection.addIceCandidate(iceCandidate);
    console.log("offer canidate added", iceCandidate);
  });
}

async function ShareScreen() {
  //getting screen share media
  let screenStream = await navigator.mediaDevices.getDisplayMedia({});
  let screenVideoTrack = screenStream.getVideoTracks()[0];

  // replacing video tracks in the peer connection
  videoSender.replaceTrack(screenVideoTrack);
  video1.srcObject = new MediaStream(screenStream.getVideoTracks());

  // toggling share button off
  shareBtn.style.display = "none";
  // listening to screenShare end
  screenVideoTrack.onended = () => {
    videoSender.replaceTrack(camVideoTrack);
    video1.srcObject = new MediaStream(localStream.getVideoTracks());
    //  toggling share button on
    shareBtn.style.display = "flex";
  };
}

const videoFullScreen = () => {
  let requestMethod =
    video1.requestFullScreen ||
    video1.webkitRequestFullScreen ||
    video1.mozRequestFullScreen ||
    video1.msRequestFullScreen;

  if (requestMethod) {
    // Native full screen.
    requestMethod.call(video2);
  }
};

const mute = () => {
  muteBtn.style.display = "none";
  unmMuteBtn.style.display = "flex";
  camAudioTrack.enabled = false;
};

const unmute = () => {
  muteBtn.style.display = "flex";
  unmMuteBtn.style.display = "none";
  camAudioTrack.enabled = true;
};

//DOM Event listeners
createBtn.addEventListener("click", createOffer);

joinBtn.addEventListener("click", answerOffer);

shareBtn.addEventListener("click", ShareScreen);

fullScreenBtn.addEventListener("click", videoFullScreen);

muteBtn.addEventListener("click", mute);

unmMuteBtn.addEventListener("click", unmute);
