//===================================================
var express = require("express"),
    bodyParser = require("body-parser"),
    mongo = require("mongoose"),
    fileUpload = require('express-fileupload'),
    AWS = require('aws-sdk');
//=================================================
var app = express();
app.set("view engine", "ejs");
app.use(fileUpload());
app.use(express.static("public"));
app.use(bodyParser.urlencoded({
    extended: true
}));
//===========================================
var s3 = new AWS.S3();
var rekognition = new AWS.Rekognition({
    region: "us-east-2"
});
//===================================================
mongo.connect("mongodb://localhost/aigallery");
var labelSchema = new mongo.Schema({
    label: String,
    ImageKeys: [{
        type: String,
    }]
});
var label = mongo.model("label", labelSchema);

var ImagefacesSchema = new mongo.Schema({
    Key: String,
    ImageID: String,
    FaceID: [{
        type: String,
    }]
});
var ImageFaces = mongo.model("ImageFaces", ImagefacesSchema);
//====================================================================
app.listen(4000, function () {
    console.log("Server started at 4000...");
});

app.get("/", (req, res) => {
    var bucketName = {
        Bucket: "yogen1",
    };
    s3.listObjects(bucketName, function (err, AllPics) {
        if (err) {
            console.log(err, err.stack);
        } else {
            //console.log(AllPics);
            var ImageKeysObj = {
                ImageKeys: []
            }
            AllPics.Contents.forEach(pic => {
                ImageKeysObj.ImageKeys.push(pic.Key);
            });
            //console.log(ImageKeysObj);
            res.render("home", {
                ImageKeysObj: ImageKeysObj
            });
        }
    });
});

app.post("/", function (req, res) {
    //uploading image to s3 bucket
    var UploadDetail = {
        Body: req.files.img.data,
        Key: req.files.img.name,
        Bucket: "yogen1",
        ServerSideEncryption: "AES256"
    };
    s3.putObject(UploadDetail, (err, data) => {
        if (err)
            console.log(err, err.stack);
        else {
            console.log(data);
            res.redirect("/");
        }

        //detection of object and assing tags
        var detectLabelParam = {
            Image: {
                S3Object: {
                    Bucket: "yogen1",
                    Name: req.files.img.name
                }
            },
            MinConfidence: 70
        };
        rekognition.detectLabels(detectLabelParam, (err, returnedLabels) => {
            if (err) {
                console.log(err, err.stack);
            } else {
                console.log(returnedLabels);
                // if tag is new .. it is created in db .. othewise push key into existing tag entry
                returnedLabels.Labels.forEach(individualLabel => {
                    label.findOne({
                        label: individualLabel.Name.toLowerCase()
                    }, (err, foundLabel) => { //console.log(err); // always return null .. not important 
                        console.log("\nFound Labels .......... \n " + foundLabel); // return object...
                        if (foundLabel == null) {
                            //console.log("Err");
                            label.create({
                                label: individualLabel.Name.toLowerCase(),
                                ImageKeys: req.files.img.name
                            }, (err, retunCreatedObj) => {
                                if (!err)
                                    console.log("\nLabel Created :" + individualLabel.Name);
                            });
                        } else {
                            //console.log("found");
                            foundLabel.ImageKeys.push(req.files.img.name)
                            foundLabel.save((err, updatedObj) => {});
                        }
                    });
                });
            }
        });

        // index face and store into collection 
        var indexingParams = {
            CollectionId: "myphotos",
            DetectionAttributes: ["ALL"],
            ExternalImageId: req.files.img.name,
            Image: {
                S3Object: {
                    Bucket: "yogen1",
                    Name: req.files.img.name
                }
            }
        };
        rekognition.indexFaces(indexingParams, (err, indexedImage) => {
            if (err) console.log(err, err.stack);
            else {
                console.log("\nIndexed Image ...." + indexedImage);
                if (indexedImage.FaceRecords.length > 0) {
                    //face db entry ... ImageID and FaceId
                    var FaceID = [];
                    indexedImage.FaceRecords.forEach(face => {
                        FaceID.push(face.Face.FaceId);
                    });
                    ImageFaces.create({
                        Key: req.files.img.name,
                        ImageID: indexedImage.FaceRecords[0].Face.ImageId, //same imageId for all indexed image
                        FaceID: FaceID
                    }, (err, newFaceData) => {
                        console.log(newFaceData);
                    })
                    //Gender And Emotion Label Entries
                    console.log("\nOnly One Face Detail From Image For Demo  : \n" + indexedImage.FaceRecords[0].FaceDetail);
                    indexedImage.FaceRecords.forEach(face => {
                        label.findOne({
                            label: face.FaceDetail.Gender.Value.toLowerCase()
                        }, (err, GenderLabel) => {
                            GenderLabel.ImageKeys.push(req.files.img.name);
                            GenderLabel.save((err, updatedObj) => {});
                        });
                        face.FaceDetail.Emotions.forEach(emotion => {
                            if (emotion.Confidence > 80) {
                                label.findOne({
                                    label: emotion.Type.toLowerCase()
                                }, (err, EmotionLabel) => {
                                    EmotionLabel.ImageKeys.push(req.files.img.name);
                                    EmotionLabel.save((err, updatedObj) => {});
                                });
                            }
                        });
                    });
                }
            }
        });
    });
});

app.get("/search/:string", (req, res) => {
    console.log(req.params.string);
    label.findOne({
        label: req.params.string
    }, (err, output) => {
        res.json(output);
    });
});

app.get("/similar/:imageKey", (req, res) => {
    var AllFaces = {
        ImageKeys: []
    };
    ImageFaces.findOne({
        Key: req.params.imageKey
    }, (err, returnedFaceIds) => {
        if (err) {
            console.log("Yo" + err);
        } else {
            console.log("NO FACE ... " + returnedFaceIds);
            if (returnedFaceIds == null)
                return res.redirect("/");
            returnedFaceIds.FaceID.forEach((faceID) => {
                var params = {
                    CollectionId: "myphotos",
                    FaceId: faceID,
                    FaceMatchThreshold: 80,
                };
                rekognition.searchFaces(params, function (err, similarFaces) {
                    if (err) console.log(err, err.stack);
                    else {
                        console.log(similarFaces);
                        similarFaces.FaceMatches.forEach((face) => {
                            AllFaces.ImageKeys.push(face.Face.ExternalImageId);
                            console.log(AllFaces);
                        });
                        console.log(AllFaces);
                        res.render("home", {
                            ImageKeysObj: AllFaces
                        });
                    }
                });
            })
        }
    });
});