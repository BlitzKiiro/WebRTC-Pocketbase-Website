import "./globals.css";
import PocketBase from "pocketbase";

//DOM query selectors
let video1 = document.querySelector("#user-1");
let video2 = document.querySelector("#user-2");
let createBtn = document.querySelector("#create-btn");
let joinBtn = document.querySelector("#join-btn");
let createInput = document.querySelector("#create-input");
let joinInput = document.querySelector("#join-input");

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

//init function
async function init() {
  //setting up local & remote media sources
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });
  remoteStream = new MediaStream();

  //adding localStream to the Peer Connection Obj
  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  //getting incoming media stream tracks from peer connection and adding it to remote stream
  peerConnection.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => {
      remoteStream.addTrack(track);
    });
  };

  video1.srcObject = new MediaStream(localStream.getVideoTracks());
  video2.srcObject = remoteStream;
}
//creating call function
async function createOffer() {
  //creating pocketbase call document and setting id
  let callDOC = await pb.collection("calls").create();
  const callID = callDOC.id;
  createInput.value = callID;

  //listen to ice candidates created PC and stun servers
  peerConnection.onicecandidate = async (event) => {
    if (event.candidate) {
      const { id } = await pb.collection("offer_candidates").create(
        {
          callID,
          rTCIceCandidate: event.candidate,
        },
        { $autoCancel: false }
      );
      callDOC = await pb.collection("calls").update(
        callID,
        {
          offer_candidates: [...callDOC?.offer_candidates, id],
        },
        { $autoCancel: false }
      );
    }
  };

  // creating RTC peer connection offer and setting it as our local RTC session description
  const offer = await peerConnection.createOffer();
  peerConnection.setLocalDescription(offer);
  callDOC = await pb.collection("calls").update(callID, { offer });

  //listen to remote answers
  pb.collection("calls").subscribe(callID, async function (e) {
    const data = e.record;
    if (!peerConnection.currentRemoteDescription && data?.answer) {
      const remoteDescription = new RTCSessionDescription(data.answer);
      await peerConnection.setRemoteDescription(remoteDescription);
    } else {
      let candidates = data.answer_candidates;
      if (
        JSON.stringify(candidates) != JSON.stringify(callDOC.answer_candidates)
      ) {
        const canDoc = await pb
          .collection("answer_candidates")
          .getOne(candidates.pop());
        const data = canDoc.rTCIceCandidate;
        const iceCandidate = new RTCIceCandidate(data);
        await peerConnection.addIceCandidate(iceCandidate);
      }
    }
  });
}

//joining call functions
async function answerOffer() {
  //getting offer call document
  const callID = joinInput.value;
  let callDoc = await pb.collection("calls").getOne(callID, {
    expand: "offer_candidates,answer_candidates",
  });

  //adding our answering end ice candidates to the server
  peerConnection.onicecandidate = async (event) => {
    if (event.candidate) {
      const { id } = await pb.collection("answer_candidates").create(
        {
          callID,
          rTCIceCandidate: event.candidate,
        },
        { $autoCancel: false }
      );
      callDoc = await pb.collection("calls").update(
        callID,
        {
          answer_candidates: [...callDoc?.answer_candidates, id],
        },
        { $autoCancel: false }
      );
    }
  };
  //getting offer doc SDP (session description) and adding it to the peer connection
  const remoteOfferDescription = new RTCSessionDescription(callDoc.offer);
  await peerConnection.setRemoteDescription(remoteOfferDescription);
  // creating our answer SDP and adding it to the server and peer connection
  const answerDescription = await peerConnection.createAnswer();
  peerConnection.setLocalDescription(answerDescription);
  await pb.collection("calls").update(callID, { answer: answerDescription });

  // listen to created offer ice candidates and add it to Peerconnection obj
  pb.collection("offer_candidates").subscribe("*", async function (e) {
    if (e.action === "create" && e.record.callID == callID) {
      const data = e.record.rTCIceCandidate;
      const iceCandidate = new RTCIceCandidate(data);
      await peerConnection.addIceCandidate(iceCandidate);
    }
  });
}

//init reading from media sources
await init();

//DOM Event listeners
createBtn.addEventListener("click", (e) => {
  createOffer();
});

joinBtn.addEventListener("click", (e) => {
  answerOffer();
});
